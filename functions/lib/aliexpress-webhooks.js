const MAX_BATCH_SIZE = 25;

function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return fallback;
  }
}

export async function processAliExpressWebhookBatch(env, limit = 10) {
  const batchSize = Math.min(
    Math.max(Number(limit) || 10, 1),
    MAX_BATCH_SIZE
  );

  const messages = await env.DB.prepare(
    `SELECT *
     FROM aliexpress_webhook_messages
     WHERE status='pending'
     ORDER BY received_at ASC
     LIMIT ?`
  )
    .bind(batchSize)
    .all();

  const results = [];

  for (const message of messages.results || []) {
    // Claim the message so concurrent requests cannot process it twice.
    const claim = await env.DB.prepare(
      `UPDATE aliexpress_webhook_messages
       SET status='processing',
           attempts=attempts+1,
           error_message=''
       WHERE idempotency_key=?
       AND status='pending'`
    )
      .bind(message.idempotency_key)
      .run();

    if (!claim.meta?.changes) {
      continue;
    }

    try {
      const payload = JSON.parse(message.payload_json);
      const data = payload.data || {};
      const orderId = String(
        data.trade_order_id ||
        message.trade_order_id ||
        ''
      );

      let matched = false;

      if (orderId) {
        const supplierOrder = await env.DB.prepare(
          `SELECT id, supplier_response_json
           FROM aliexpress_supplier_orders
           WHERE ae_order_id=?
           LIMIT 1`
        )
          .bind(orderId)
          .first();

        if (supplierOrder) {
          matched = true;

          const previous = safeJsonParse(
            supplierOrder.supplier_response_json
          );

          const events = Array.isArray(previous.webhook_events)
            ? previous.webhook_events
            : [];

          events.push({
            message_type: Number(message.message_type),
            trade_order_id: orderId,
            order_status: String(data.order_status || ''),
            status_update_time: String(
              data.status_update_time || ''
            ),
            received_at: String(message.received_at || ''),
            payload: data
          });

          // Keep the event history bounded.
          previous.webhook_events = events.slice(-50);

          await env.DB.prepare(
            `UPDATE aliexpress_supplier_orders
             SET supplier_response_json=?,
                 updated_at=CURRENT_TIMESTAMP
             WHERE id=?`
          )
            .bind(
              JSON.stringify(previous),
              supplierOrder.id
            )
            .run();
        }
      }

      // Mark the notification processed, including unmatched notifications.
      // Unmatched messages remain available in the queue's payload for review.
      await env.DB.prepare(
        `UPDATE aliexpress_webhook_messages
         SET status='processed',
             error_message=?,
             processed_at=CURRENT_TIMESTAMP
         WHERE idempotency_key=?
         AND status='processing'`
      )
        .bind(
          matched
            ? ''
            : orderId
              ? 'No matching supplier order was found.'
              : 'Notification did not contain a trade order ID.',
          message.idempotency_key
        )
        .run();

      results.push({
        idempotency_key: message.idempotency_key,
        message_type: Number(message.message_type),
        matched,
        status: 'processed'
      });

    } catch (error) {
      console.error(
        'AliExpress webhook processing failed:',
        message.idempotency_key,
        error
      );

      await env.DB.prepare(
        `UPDATE aliexpress_webhook_messages
         SET status='failed',
             error_message=?,
             processed_at=CURRENT_TIMESTAMP
         WHERE idempotency_key=?
         AND status='processing'`
      )
        .bind(
          String(error?.message || 'Processing failed.').slice(0, 500),
          message.idempotency_key
        )
        .run();

      results.push({
        idempotency_key: message.idempotency_key,
        status: 'failed'
      });
    }
  }

  return {
    checked: messages.results?.length || 0,
    results
  };
}
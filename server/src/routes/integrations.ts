import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { broadcast } from '../events.ts';
import { HttpError } from '../http.ts';
import { afterStockChange } from '../modules/availability.ts';
import { handleBankTransaction, verifyWebhookKey } from '../modules/bank.ts';
import { pendingJobs, reportJob } from '../modules/printing.ts';
import { getSecrets } from '../settings.ts';
import { idParam } from './auth.ts';

// Kết nối bên ngoài: webhook ngân hàng và chương trình in trên máy quầy.

export const integrationsRouter = Router();

integrationsRouter.post('/webhooks/bank', async (req, res) => {
  verifyWebhookKey(req.get('authorization'));
  const result = await handleBankTransaction(req.body ?? {});
  if (result.status === 'paid' || result.status === 'amount_mismatch') {
    broadcast({ type: 'payment', tableId: result.tableId, sessionId: result.sessionId, amount: result.amount });
    broadcast({ type: 'table', tableId: result.tableId });
    broadcast({ type: 'data' });
    afterStockChange();
  }
  // SePay coi phản hồi 2xx kèm success=true là đã nhận.
  res.json({ success: true, status: result.status });
});

function requireAgent(req: Request, _res: Response, next: NextFunction) {
  const key = Buffer.from(req.get('x-agent-key') ?? '');
  const expected = Buffer.from(getSecrets().printAgentKey);
  if (key.length !== expected.length || !timingSafeEqual(key, expected)) throw new HttpError(401, 'unauthorized');
  next();
}

integrationsRouter.get('/print-agent/jobs', requireAgent, (_req, res) => {
  res.json(pendingJobs());
});

integrationsRouter.post('/print-agent/jobs/:id', requireAgent, (req, res) => {
  reportJob(idParam(req), req.body?.ok === true, req.body?.error);
  res.status(204).end();
});

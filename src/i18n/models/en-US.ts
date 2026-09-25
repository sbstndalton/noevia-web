import type { ModelsCatalogue } from './en-GB';

// American English: only the model manager strings whose spelling differs from the British base.
export const EN_US_MODELS: ModelsCatalogue = {
  'mm.status.cancelled': 'canceled',
  'mm.card.quant': 'Quantization',
  'mm.repo.estimatesNote': 'Estimates use the same fit math as Autoconfig for this server. Speed is relative to running fully on the GPU.',
  'mm.queue.cancelled': 'Canceled',
  'mm.filters.hint': 'size, parameters, architecture, license, publisher',
  'mm.filters.licence': 'License',
  'mm.easy.kv': 'KV cache quantization',
  'mm.fit.rec.smaller': 'This model needs about {floor} GiB before any context, and the smallest context does not fit {budget} GiB even with Q5 KV cache. Choose a smaller quantization.',
  'mm.fit.rec.smallerMoe': 'This model needs about {floor} GiB before any context, and the smallest context does not fit {budget} GiB even with Q5 KV cache. Choose a smaller quantization or configure CPU expert offload in Advanced.',
  'mm.hw.notMeasured': 'No live GPU readings: this llama.cpp image has no GPU monitoring tool and the kernel does not report this GPU. Only the declared memory size ({size}) is known, so utilization charts are hidden.',
  'mm.evidence.license': '{license} license',
};

import './bootstrap';

import './workers/media';
import './workers/media-transcribe';
import './workers/youtube-captions';
import './workers/emails';
import './workers/notifications';
import './workers/webhooks';
import './workers/maintenance';
import './workers/agent-course-generation';
import './workers/exam-import';

import { log } from './utils/logger';

log.info('all-workers-running', {
  workers: [
    'media',
    'media-transcribe',
    'emails',
    'notifications',
    'webhooks',
    'maintenance',
    'agent-course-generation',
    'exam-import',
    'youtube-captions'
  ]
});

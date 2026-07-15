import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { OPERATOR_EMAIL, PRODUCT_HOSTS, PRODUCT_NAME } from '@cio/utils/constants';

export const welcomeEmail = defineEmail({
  id: 'welcome',
  subject: `Welcome to ${PRODUCT_NAME}!`,
  schema: z.object({
    name: z.string().min(1)
  }),
  render: (fields) => {
    const content = `
    <p>Dear ${fields.name},</p>
    <p>Welcome to ${PRODUCT_NAME}. If you have any questions, reply to this email and we will help.</p>
    <p>
     Would you like to get a walkthrough of the platform in a 30 minutes product demo? It's free and we won't try to sell you anything, just want to learn from your use case and show you all the cool features and flows we thought about.
    </p>
    <p>
      Interested? just book a 30-minute demo slot in our calendar!
    </p>
    <div>
      <a class="button" href="https://${PRODUCT_HOSTS.marketing}">Open ${PRODUCT_NAME}</a>
    </div>
    <p>
      PS: You can also contact us directly at ${OPERATOR_EMAIL}.
    </p>
  `;

    return getDefaultTemplate(content);
  }
});

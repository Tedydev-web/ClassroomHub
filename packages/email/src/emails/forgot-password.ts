import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';
import { OPERATOR_EMAIL, PRODUCT_NAME } from '@cio/utils/constants';

export const forgotPasswordEmail = defineEmail({
  id: 'forgotPassword',
  subject: `Password reset notification - ${PRODUCT_NAME}`,
  schema: z.object({
    email: z.email(),
    name: z.string().min(1),
    link: z.url()
  }),
  render: (fields) => {
    const content = `Hello ${fields.name},
    <p>You are receiving this email because you have requested a password reset for your ${PRODUCT_NAME} account.</p>
    <p>Please click the button below to reset your password:</p>
    
    <div>
      <a class="button" href="${fields.link}">Reset my password</a>
    </div>

    <p>PS: If you did not initiate this request, reply to this email or write to ${OPERATOR_EMAIL} so we can look into a possible attempt to breach your account.</p>
    `;

    return getDefaultTemplate(content);
  }
});

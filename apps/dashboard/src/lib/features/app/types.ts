import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type AccountResponse = InferResponseType<typeof classroomhub.account.$get> | null;

export type AccountSuccess = Extract<InferResponseType<typeof classroomhub.account.$get>, { success: true }>;

export type AccountOrg = AccountSuccess['organizations'][number];

export type PublicOrg = Pick<
  AccountOrg,
  | 'id'
  | 'name'
  | 'siteName'
  | 'avatarUrl'
  | 'favicon'
  | 'theme'
  | 'isRestricted'
  | 'landingpage'
  | 'customDomain'
  | 'isCustomDomainVerified'
  | 'disableSignup'
  | 'disableSignupMessage'
  | 'disableEmailPassword'
  | 'disableGoogleAuth'
> & {
  settings: {
    signup?: {
      inviteOnly?: boolean;
    };
  };
  customization: {
    auth?: {
      backgroundImage?: string;
    };
  };
  plans: Array<Pick<AccountOrg['plans'][number], 'planName' | 'isActive'>>;
};

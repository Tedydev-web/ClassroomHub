import { db, organization } from '@db/drizzle';

export async function seedOrganization({
  testOrgId,
  enterpriseOrgId,
  earlyAdopterOrgId,
  extendedDemo = false
}: {
  testOrgId: string;
  enterpriseOrgId: string;
  earlyAdopterOrgId: string;
  extendedDemo?: boolean;
}) {
  const existingOrgs = await db.select().from(organization);
  const existingOrgIds = existingOrgs.map((o) => o.id);

  const organizations = [
    {
      id: testOrgId,
      name: 'Udemy Test',
      siteName: 'udemy-test',
      settings: {},
      landingpage: {},
      theme: '',
      customization: {
        apps: { comments: true },
        course: { grading: true, newsfeed: true },
        dashboard: { exercise: true, community: true, bannerText: '', bannerImage: '' }
      }
    },
    {
      id: enterpriseOrgId,
      name: 'Coursera Test',
      siteName: 'coursera-test',
      settings: {},
      landingpage: {},
      theme: '',
      customization: {
        apps: { comments: true },
        course: { grading: true, newsfeed: true },
        dashboard: { exercise: true, community: true, bannerText: '', bannerImage: '' }
      }
    },
    {
      id: earlyAdopterOrgId,
      name: 'Skillshare Test',
      siteName: 'skillshare-test',
      settings: {},
      landingpage: {},
      theme: '',
      customization: {
        apps: { comments: true },
        course: { grading: true, newsfeed: true },
        dashboard: { exercise: true, community: true, bannerText: '', bannerImage: '' }
      }
    }
  ];
  const organizationsToInsert = organizations
    .filter((organizationRecord) => extendedDemo || organizationRecord.id === testOrgId)
    .filter((organizationRecord) => !existingOrgIds.includes(organizationRecord.id));

  if (organizationsToInsert.length > 0) {
    await db.insert(organization).values(organizationsToInsert);
    console.log(`   ✓ Inserted ${organizationsToInsert.length} organization(s)`);
  } else {
    console.log('   ✓ Organizations already exist, skipping');
  }
}

import { defineConfig } from 'blume';

/**
 * The site is served at classroom.io.vn/docs through the marketing Worker's
 * service binding. `deployment.base` only
 * rewrites URLs in the emitted HTML — it does not nest the build output, so
 * scripts/package-assets.mjs moves dist/ under docs/ to match the served path.
 *
 * Redirects are NOT declared here: under a base, Astro prefixes a redirect's
 * source but not its target, so it would emit `url=/guides` instead of
 * `/docs/guides`. They live in scripts/package-assets.mjs as a `_redirects` file.
 */
export default defineConfig({
  title: 'ClassroomHub Docs | Customer, Partner, and Employee Education',
  description:
    'Learn how to create customer academies, partner certification programs, and employee training workflows in ClassroomHub.',
  logo: {
    text: '',
    image: '/docs/wordmark.svg',
    href: '/docs'
  },
  content: {
    root: 'content/docs'
  },
  deployment: {
    output: 'static',
    site: 'https://classroom.io.vn',
    base: '/docs'
  },
  github: {
    owner: 'Tedydev-web',
    repo: 'classroomhub',
    dir: 'apps/docs'
  },
  theme: {
    mode: 'system'
  },
  search: {
    provider: 'orama'
  },
  ai: {
    llmsTxt: true
  },
  seo: {
    // Read directly from `public/` by Blume's OG renderer — unlike
    // `logo.image` above, this is NOT rewritten with the `/docs` deployment
    // base, so it must be the public-relative path, not the served URL.
    og: {
      logo: '/logo.svg'
    }
    // No `x` block: the upstream project's handle is not this deployment's, and
    // a twitter:creator card naming someone else attributes the docs to them.
  },
  openapi: {
    enabled: true,
    renderer: 'scalar',
    route: '/api',
    sources: [{ label: 'API', spec: './openapi/public-api.json' }]
  },
  navigation: {
    tabs: [
      { label: 'Platform', path: '/', icon: 'house' },
      { label: 'Guides', path: '/guides', icon: 'book-open' },
      { label: 'API', path: '/api', icon: 'code' }
    ],
    sidebar: [
      {
        label: 'Platform',
        items: [
          '/',
          {
            label: 'Introduction',
            items: [
              '/what-is-classroomio',
              '/terminology',
              {
                label: 'Quickstart',
                items: ['/quickstart/signup', '/quickstart/onboarding']
              }
            ]
          },
          {
            label: 'Core Features',
            items: [
              '/course',
              '/cohorts',
              '/mcp',
              '/tags',
              '/audience',
              '/community',
              '/organization',
              '/student-dashboard',
              '/enterprise-sso',
              '/token-auth'
            ]
          }
        ]
      },
      {
        label: 'Guides',
        root: '/guides',
        items: [
          '/guides',
          {
            label: '',  // User Guides
            items: [
              {
                label: 'Get started',
                items: ['/guides/create-first-course']
              },
              {
                label: 'Build a course',
                items: [
                  '/guides/course-types',
                  '/guides/create-exercise',
                  '/guides/grade-exercise',
                  '/guides/course-progression',
                  '/guides/use-math-in-editor',
                  '/guides/certificates'
                ]
              },
              {
                label: 'Live classes',
                items: ['/guides/live-class', '/guides/take-attendance']
              },
              {
                label: 'Enrollment & students',
                items: [
                  '/guides/course-enrollment',
                  '/guides/enrollment-access-control',
                  '/guides/welcome-email',
                  '/guides/invite-students'
                ]
              },
              {
                label: 'Publish your academy',
                items: [
                  '/guides/course-landingpage',
                  '/guides/org-landing-page',
                  '/guides/academy-sharing-and-branding',
                  '/guides/custom-domain'
                ]
              },
              {
                label: 'Organization & team',
                items: [
                  '/guides/admin-dashboard',
                  '/guides/customize-organization',
                  '/guides/invite-team-member',
                  '/guides/roles-and-permissions'
                ]
              }
            ]
          },
          {
            label: 'Developer Guides',
            items: [
              '/guides/contributing',
              '/guides/contributing/devs',
              '/guides/contributing/design',
              '/guides/contributing/cloudflare-setup',
              '/guides/contributing/org-site-opengraph-and-favicon',
              '/guides/contributing/gitpod',
              '/guides/contributing/demo-accounts',
              '/guides/contributing/student-dashboard',
              '/guides/contributing/adding-translation-to-code'
            ]
          }
        ]
      }
    ]
  }
});

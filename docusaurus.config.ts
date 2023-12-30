import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'violet180111’s blog',
  tagline: '花无凋零之日，意无传递之时，爱情亘古不变，紫罗兰与世长存',
  favicon: 'images/favicon.ico',

  url: 'https://violet180111.github.io',
  baseUrl: '/',

  organizationName: 'violet180111',
  projectName: 'violet180111.github.io',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'images/docusaurus-social-card.jpg',
    navbar: {
      title: 'violet180111',
      logo: {
        alt: 'violet180111-blog-logo',
        src: 'images/violet.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'blog',
          position: 'left',
          label: 'blog',
        },
        {
          href: 'https://github.com/violet180111',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

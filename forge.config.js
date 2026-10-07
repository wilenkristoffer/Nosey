module.exports = {
  packagerConfig: {
    asar: true,
    icon: './assets/icon',
    win32metadata: {
      FileDescription: 'Nosey Desktop AI Companion',
      ProductName: 'Nosey',
    },
    // debug/ may hold screenshots of real screens from older versions; it must
    // never end up inside an installer
    ignore: [
      /^\/debug\//,
      /^\/out\//,
      /^\/coverage\//,
      /^\/phases\//,
      /^\/PLAN\.md$/,
      /^\/PLAN_MEMORY\.md$/,
      /^\/CLAUDE\.md$/,
      /^\/\.env/,
      /\.log$/,
      /\.test\.js$/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Nosey',
        setupExe: 'NoseySetup.exe',
        setupIcon: './assets/icon.ico',
        noMsi: true,
      },
    },
  ],
}

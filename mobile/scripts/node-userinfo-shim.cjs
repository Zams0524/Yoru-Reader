const os = require('node:os');
os.userInfo = () => ({
  uid: -1,
  gid: -1,
  username: process.env.USERNAME || 'YoruBuild',
  homedir: process.env.USERPROFILE || process.cwd(),
  shell: process.env.ComSpec || ''
});

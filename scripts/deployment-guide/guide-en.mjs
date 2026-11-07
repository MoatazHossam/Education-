// The English deployment guide (scripts/deployment-guide/build.mjs en). Keep it in step with guide-ar.mjs. Button and
// page names are the English interface's own (public/js/i18n.js), between “”.
export default function guideEn({ p, h1, h2, bullet, check, steps, code, box, table, title, VERSION, TESTED, TESTED_ON, TODAY, ZIP, DOMAIN, DC, SETTINGS }) {
  // ------------------------------------------------------------ title
  title('Deploying Midad on a production server', 'A free pilot for schools, with student accounts, on an Ubuntu Linux server', [
    ['Package version: ', { l: VERSION }, ' · Package file: ', { l: ZIP }],
    TODAY,
  ]);
  box('warn', 'Read all of section 1 before any step: it says what was tested and what was not, and the conditions for using real students’ data.');
  p('How to read this guide:');
  bullet(['Commands are in grey boxes. Copy each box as it is, paste it into the server’s window, then press Enter.']);
  bullet(['Everything you must replace with your own values is at the top of its box, such as ', { c: DOMAIN }, ' and ', { c: 'ops@example.com' }, '. Change nothing else.']);
  bullet(['The scripts ask their questions in the terminal; this guide gives each question and the answer to give. Yes/no questions are answered with ', { c: 'y' }, ' or ', { c: 'n' }, '; the value in square brackets at the end of a question is the default (Enter accepts it).']);
  bullet('Copy commands from the grey boxes only, not from inside sentences.');
  bullet(['Button and page names are written as they appear in Midad’s English interface, between “ ”.']);

  // ------------------------------------------------------------ 1
  h1('1. Are we ready? What was tested and what was not');
  p('The package is ready for a real pilot on one server, under the conditions given here. It is not ready for a broad commercial launch.');
  const same = VERSION === TESTED;
  h2(same ? 'What was tested on this very package' : ['What was tested on package ', { l: TESTED }]);
  if (!same) box('warn', ['This guide is for package ', { l: VERSION }, ', but the test described here was on package ', { l: TESTED }, ': some commands or button names may have changed between the two.']);
  p([`On ${TESTED_ON}, the file `, { c: `midad-${TESTED}.zip` }, ' was unpacked in an empty folder on a Linux machine with Docker 29.9.1, and the commands in sections 5.1, 6, 7, 8, 9, 10.1 and 10.2 of this guide were run as written, with the test domain ', { c: 'localhost' }, ':']);
  bullet('The settings commands (section 5) created the file with all its passwords and keys, and no “change-me” value was left in it.');
  bullet(['The start script ', { c: 'ops/start.sh --env prod' }, ' started all seven services, both app instances became ready, and ', { c: 'https://localhost/readyz' }, ' answered with status 200.']);
  bullet('In the Arabic interface, in this order: the platform admin was created, changed its password and turned on two-factor authentication. Then a school registered and received the confirmation email. The platform admin gave it a plan with no end date and 100 student accounts. The school added a student, who signed in, and the test alert reached the operations mailbox. All eleven steps passed, then all passed again in the English interface after the test installation’s data was deleted and it was started afresh.');
  bullet(['An encrypted backup was taken with ', { c: 'ops/backup.sh' }, ' and tested with ', { c: 'ops/restore.sh --only-verify' }, ': the row counts matched in all 61 tables.']);
  p('Before that, the package passed all its automated tests (561 tests, and 32 tests in the browser), and earlier Docker drills of the production stack: backup and restore to another server and to cloud storage, going back to an earlier release, and running under an exam’s load.');
  h2('What has not been tested yet');
  bullet('Deploying on a real server on the internet. The commands to install Docker on Ubuntu, the ufw firewall, DNS and a real Let’s Encrypt certificate were not run here (the test used Caddy’s internal certificate for localhost). The Docker commands are copied word for word from Docker’s official documentation.');
  bullet('A real email provider: sending was tested with a local test mailbox; the same settings work with any SMTP server.');
  bullet('The steps for upgrading to a new release (section 12), the scheduled jobs (section 10.3), and the backup script’s questions (the test backup was taken with the default answers).');
  bullet('An external penetration test, and a legal review.');
  h2('Conditions for the pilot');
  box('warn', ['Students’ data: the legal review of data about students who are minors (consent, the contract with schools, how long data is kept, and the privacy policy) has not been done yet. Do not enter real students’ data before a legal adviser approves it in writing and each school signs its consent. Midad stores a student’s name, username, grade, curriculum, homework, tests and grades; it does not store the student’s email, date of birth or any way to contact them.']);
  bullet('Payment is off: nobody pays anything, and there is no payment gateway. Every new school automatically gets 14 days of the Professional plan, then moves to the Free plan. The platform admin makes its use free with no time limit (section 8).');
  bullet('The curriculum catalogue’s content (231 subjects) has not been reviewed by a specialist yet: present it to schools as a first draft.');
  bullet('AI assistance is off in this guide (it needs a paid provider key).');

  // ------------------------------------------------------------ 2
  h1('2. What you need before you start');
  table([['Item'], ['Details']], [
    [[{ b: 'Linux server' }], ['Ubuntu 24.04 LTS (or 22.04 or 26.04), with an x86-64 (amd64) processor and a fixed public IPv4 address. Recommended: 4 virtual CPUs, 8 GB of memory and 80 GB of SSD storage. The minimum is 2 CPUs and 4 GB, with the settings in section 5.4 and swap (section 3.5).']],
    [[{ b: 'About the processor' }], ['Do not choose a server with an ARM processor (such as Ampere or Graviton): the virus scanner in the package does not run on it.']],
    [[{ b: 'Domain' }], ['A domain or subdomain, such as ', { c: DOMAIN }, ', and the right to add a DNS record for it.']],
    [[{ b: 'SMTP email provider' }], ['The SMTP server’s name, the port (465 or 587), the username, the password, and a sender address verified with the provider on your domain (SPF and DKIM). Without it, registration confirmations and password resets do not arrive.']],
    [[{ b: 'Operations team email' }], ['An address used for the platform admin, for operational alerts and for the HTTPS certificate.']],
    [[{ b: 'Password manager' }], ['To keep the settings file, the backup passphrase and the admin’s passwords.']],
    [[{ b: 'Phone with an authenticator app' }], ['Google Authenticator, Microsoft Authenticator or similar, for the platform admin’s two-factor authentication (required).']],
    [[{ b: 'A place for copies off the server' }], ['Strongly recommended: S3-compatible cloud storage, another server over SFTP, or a disk. A copy on the server itself is lost if the server is lost.']],
    [[{ b: 'Your computer' }], ['A computer you connect to the server from over SSH (Windows 10/11, macOS or Linux), with the package file ', { c: ZIP }, ' on it.']],
  ], [1, 3]);
  p('Decide these values now and write them down; you will need them in section 5:');
  table([['Value'], ['Example'], ['Notes']], [
    [['Domain'], [{ c: DOMAIN }], ['Without https:// and without / at the end']],
    [['Operations email'], [{ c: 'ops@example.com' }], ['A real address that you read']],
    [['SMTP address'], [{ c: 'smtps://USER:PASS@smtp.example.net:465' }], ['From the email provider (section 5.2)']],
    [['Sender'], [{ c: 'Midad <no-reply@midad.example.com>' }], ['An address verified with the email provider']],
  ], [1, 2, 2]);

  // ------------------------------------------------------------ 3
  h1('3. Preparing the server');
  h2('3.1 DNS record');
  p(['In your domain’s control panel, add a record of type ', { c: 'A' }, ': the name is the subdomain (such as ', { c: 'midad' }, ') and the value is the server’s IPv4 address. Wait until your computer shows the right address:']);
  code([`nslookup ${DOMAIN}`]);
  p('Do not go on to section 6 before the domain points to the server: the HTTPS certificate is requested on the first start.');
  h2('3.2 Connecting to the server and updating it');
  p('From your computer (Windows: PowerShell; macOS and Linux: Terminal), with your server’s address in place of this one:');
  code(['ssh root@203.0.113.10']);
  p(['If the provider gave you a user other than root (such as ', { c: 'ubuntu' }, '), connect with it, then type ', { c: 'sudo -i' }, '. Every command in this guide runs as root.']);
  code(['apt update && apt upgrade -y', 'apt install -y unzip', 'timedatectl']);
  h2('3.3 Firewall');
  p('Allow three ports only: SSH, 80 and 443:');
  code(['ufw allow OpenSSH', 'ufw allow 80/tcp', 'ufw allow 443/tcp', 'ufw --force enable', 'ufw status verbose']);
  box('note', 'If your hosting provider has a firewall in its control panel (a security group or firewall), allow incoming ports 22, 80 and 443 there too. The database is never opened to the internet: it is only published inside Docker.');
  h2('3.4 Installing Docker');
  p('These commands are from Docker’s official documentation for Ubuntu, using the apt repository. Copy them as they are:');
  code([
    '# Add Docker\'s official GPG key:',
    'sudo apt update',
    'sudo apt install ca-certificates curl',
    'sudo install -m 0755 -d /etc/apt/keyrings',
    'sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc',
    'sudo chmod a+r /etc/apt/keyrings/docker.asc',
    '',
    '# Add the repository to Apt sources:',
    'sudo tee /etc/apt/sources.list.d/docker.sources <<EOF',
    'Types: deb',
    'URIs: https://download.docker.com/linux/ubuntu',
    'Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")',
    'Components: stable',
    'Architectures: $(dpkg --print-architecture)',
    'Signed-By: /etc/apt/keyrings/docker.asc',
    'EOF',
    '',
    'sudo apt update',
  ]);
  code(['sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin']);
  p(['If you are asked ', { c: 'Do you want to continue? [Y/n]' }, ', type ', { c: 'Y' }, ' and press Enter. Then make Docker start by itself after the server restarts, and check that it works:']);
  code(['sudo systemctl enable docker.service', 'sudo systemctl enable containerd.service', 'sudo docker run hello-world', 'docker compose version']);
  p(['The expected result: a message that starts with ', { c: 'Hello from Docker!' }, ', then Compose’s version (it starts with ', { c: 'Docker Compose version v2' }, ' or higher).']);
  h2('3.5 Swap (only for a server with 4 GB)');
  code(['fallocate -l 2G /swapfile', 'chmod 600 /swapfile', 'mkswap /swapfile', 'swapon /swapfile', "echo '/swapfile none swap sw 0 0' >> /etc/fstab", 'free -h']);
  p(['In the output of ', { c: 'free -h' }, ', the ', { c: 'Swap' }, ' line must show 2.0Gi.']);

  // ------------------------------------------------------------ 4
  h1('4. Uploading the package to the server');
  p(['From your computer, in the folder that holds ', { c: ZIP }, ':']);
  code([`scp ${ZIP} root@203.0.113.10:/root/`]);
  p('Then on the server:');
  code(['cd /opt', `unzip /root/${ZIP}`, 'cd /opt/midad', 'ls ops']);
  p(['You should see files including ', { c: 'start.sh' }, ', ', { c: 'backup.sh' }, ' and ', { c: 'midad.sh' }, '. From now on the installation lives in ', { c: '/opt/midad' }, '. Do not rename the folder: Docker names the installation’s data after it.']);
  box('note', ['If you uploaded the file as a user other than root, it is in that user’s folder: replace ', { c: '/root/' }, ' with ', { c: '/home/<user>/' }, ' in the unzip command.']);

  // ------------------------------------------------------------ 5
  h1('5. The settings file');
  p(['All of the installation’s settings and secrets are in one file, ', { c: '/opt/midad/.env.production' }, '. The commands below create it from the example, generate the five database passwords and the session and encryption keys at random, and turn payment off. They show no secret on the screen.']);
  h2('5.1 Creating the file');
  p(['Change the two values on the first two lines only (the domain and the operations email), then paste the whole box at once:']);
  code(SETTINGS);
  p(['The expected result on the last line: the number ', { c: '0' }, ' (no change-me value is left).']);
  box('warn', ['Run this box only once in the installation’s life. Running it again after the app’s first start generates new keys and passwords, which open neither the existing database nor the encrypted secrets. To change a value afterwards, edit the file in the editor (section 5.2).']);
  h2('5.2 Email (SMTP)');
  p('Open the file in the editor:');
  code(['nano /opt/midad/.env.production']);
  p(['Find (Ctrl+W) the lines ', { c: 'SMTP_URL=' }, ' and ', { c: 'EMAIL_FROM=' }, ' and give them your provider’s values, in one of these two forms:']);
  code(['SMTP_URL=smtps://USERNAME:PASSWORD@smtp.example.net:465', 'EMAIL_FROM=Midad <no-reply@midad.example.com>'], 'Port 465 (encrypted from the start):');
  code(['SMTP_URL=smtp://USERNAME:PASSWORD@smtp.example.net:587'], 'Or port 587 (STARTTLS):');
  p('If the username or the password contains one of these characters, write what is next to it instead:');
  table([['Character'], ['Write'], ['Character'], ['Write']], [
    [[{ c: '@' }], [{ c: '%40' }], [{ c: ':' }], [{ c: '%3A' }]],
    [[{ c: '/' }], [{ c: '%2F' }], [{ c: '#' }], [{ c: '%23' }]],
    [[{ c: '?' }], [{ c: '%3F' }], [{ c: '%' }], [{ c: '%25' }]],
    [[{ c: '&' }], [{ c: '%26' }], ['space'], [{ c: '%20' }]],
  ], [1, 1, 1, 1]);
  p(['Save and leave: Ctrl+O, then Enter, then Ctrl+X. Do not put quotation marks around the values.']);
  h2('5.3 Checking the file and keeping a copy');
  code(["grep -E '^(NODE_ENV|APP_URL|DOMAIN|ACME_EMAIL|ALERT_EMAILS|BILLING_PROVIDER|EMAIL_TRANSPORT|EMAIL_FROM)=' /opt/midad/.env.production"]);
  p('The expected result (with your values):');
  code(['APP_URL=https://midad.example.com', 'NODE_ENV=production', 'EMAIL_TRANSPORT=smtp', 'EMAIL_FROM=Midad <no-reply@midad.example.com>', 'BILLING_PROVIDER=disabled', 'ALERT_EMAILS=ops@example.com', 'DOMAIN=midad.example.com', 'ACME_EMAIL=ops@example.com']);
  p(['Copy the file to your computer and keep it in the password manager, then delete the copy from your computer. The most important value in it is ', { c: 'DATA_ENCRYPTION_KEY' }, ': without it, the two-factor secrets cannot be read, even from a backup. From your computer:']);
  code(['scp root@203.0.113.10:/opt/midad/.env.production ./midad.env.production']);
  box('warn', 'Do not send this file by email or in a chat, and never upload it to a code repository.');
  h2('5.4 A server with only 4 GB of memory');
  p('The default settings are for a server with 8 GB. On a server with 4 GB, run this too, before section 6:');
  code(['cd /opt/midad', 'setv() { sed -i "s|^$1=.*|$1=$2|" .env.production; }', 'setv POSTGRES_MEMORY_LIMIT 1g', 'setv POSTGRES_SHARED_BUFFERS 256MB', 'setv POSTGRES_EFFECTIVE_CACHE_SIZE 512MB', 'setv POSTGRES_WORK_MEM 8MB', 'setv POSTGRES_MAINTENANCE_WORK_MEM 64MB', 'setv APP_MEMORY_LIMIT 512m', 'setv APP_HEAP_MB 384', 'setv WORKER_MEMORY_LIMIT 768m', 'setv WORKER_HEAP_MB 384', 'setv CLAMAV_MEMORY_LIMIT 1536m', 'setv CADDY_MEMORY_LIMIT 128m']);

  // ------------------------------------------------------------ 6
  h1('6. The first start');
  code(['cd /opt/midad', 'ops/start.sh --env prod']);
  p('What happens, in order:');
  steps([
    'The script checks the settings file: the required values are there, no value is change-me, the address starts with https://, and nobody else can read the file.',
    ['It prints a message that starts with ', { c: 'The app image is not built yet' }, ' and builds the app’s image (5 to 15 minutes the first time; it needs an internet connection).'],
    'It starts the seven services, and Caddy requests the HTTPS certificate for your domain by itself.',
    ['It waits until it prints ', { c: 'app is ready' }, ' and ', { c: 'app2 is ready' }, ', then a status table that ends with ', { c: 'Address: https://midad.example.com' }, '.'],
  ]);
  p(['On later starts it asks ', { c: 'Rebuild the app image first (after updating the code)? (y/n) [n]' }, '. Answer ', { c: 'n' }, ', except after uploading a new release (section 12).']);
  p('Check from the server itself:');
  code([`curl -fsS https://${DOMAIN}/readyz`]);
  p('The expected result:');
  code(['{"status":"ready","checks":{"database":{"status":"ok","latencyMs":1},"migrations":{"status":"ok"}}}']);
  p(['Then open ', { c: `https://${DOMAIN}` }, ' in your browser: the sign-in page appears, with a valid HTTPS padlock. The virus scanner needs a minute or two after the first start to load its signatures.']);
  box('note', ['If HTTPS does not work: check the DNS record (section 3.1) and ports 80 and 443 (section 3.3), then read Caddy’s log with the command below. Caddy requests the certificate again by itself.']);
  code(['cd /opt/midad', `${DC} logs --tail 50 caddy`]);

  // ------------------------------------------------------------ 7
  h1('7. The platform admin');
  h2('7.1 Creating the account');
  p('Change the email to the operations email:');
  code(['cd /opt/midad', `${DC} exec app node dist/cli/create-platform-admin.js --email ops@example.com --name "Platform Admin"`]);
  p('The result:');
  code(['Created platform administrator ops@example.com', 'One-time password: ****************', 'Sign in, change the password and enable two-factor authentication.']);
  p('The one-time password is shown only once: use it in the next step straight away.');
  h2('7.2 The first sign-in (in the browser)');
  steps([
    ['Open ', { c: `https://${DOMAIN}/login` }, ', type the email and the one-time password, then “Sign in”.'],
    ['Open “Your account” (', { c: `https://${DOMAIN}/account` }, '). In the “Password” section, type the one-time password in “Current password” and a new long password (at least 10 characters) in “New password”, then “Change password”. Keep the new one in the password manager.'],
    'In the “Security” section: “Set up two-factor authentication” → scan the QR code with the authenticator app on your phone → type the 6-digit code in “Authentication code” → “Turn on”.',
    '“Save your recovery codes” appears: keep them all in the password manager (each code works once, if you lose the phone), then “I have saved them”.',
    ['Open “Platform admin” (', { c: `https://${DOMAIN}/admin` }, '): “Platform overview” appears. The platform admin pages work only once two-factor authentication is on.'],
    ['In “Platform overview”, on the “Alerts” card: “Send test alert”. An email arrives at the operations address with ', { c: 'Test alert' }, ' and your domain in its subject. It proves that email works.'],
  ]);
  box('note', ['The account this command creates uses the English interface. To use Arabic instead: in “Your account”, choose “العربية” in “Language”, then “Save”; the Arabic guide names every button in Arabic.']);
  box('ok', 'Steps 1 to 6 were all run in the test (section 1), with these same names in the interface.');

  // ------------------------------------------------------------ 8
  h1('8. Opening Midad to schools for free');
  h2('8.1 A school registers by itself');
  steps([
    ['The school’s administrator opens ', { c: `https://${DOMAIN}/register` }, ' and types “Your name”, “Email”, “Password” (at least 10 characters; common passwords are refused) and “Organization name” (the school’s name), then “Create account”.'],
    'An email with the subject “Confirm your email address” arrives: the administrator clicks the link in it, sees “Your email is confirmed. You can sign in now.”, then signs in.',
    'They are now the school’s owner in Midad, and invite their colleagues by email from the “Members” page.',
  ]);
  p('What happens by itself: 14 days of the Professional plan, then the school moves to the Free plan on its own (2 members, one content scope, no student accounts). The school’s “Billing” page says: “Online payment is not enabled. Contact sales to subscribe.”');
  h2('8.2 The platform admin makes it free with no time limit');
  steps([
    '“Platform admin” → “Organizations” → search for the school’s name → open it.',
    ['On the “Subscription” card, under “Manual plan assignment”:'],
  ]);
  table([['Field'], ['Value'], ['What it means']], [
    [['“Plan”'], [{ l: 'Professional' }, ' (or ', { l: 'Enterprise' }, ')'], ['Professional: up to 25 members and 100 content scopes. Enterprise: no limits on members or scopes.']],
    [['“Status”'], ['“active”'], ['The subscription is in force']],
    [['“Period end (leave empty for open-ended)”'], ['empty'], ['No end date, and no renewal invoices']],
    [['“Student accounts (override)”'], ['The number of students, such as 300'], ['Opens the student portal for the school, up to this number. Empty: no student accounts']],
    [['“Classroom file storage, MB (override)”'], ['Optional, such as 2048'], ['Space for homework photos and files. The default is 1024 (1 GB)']],
    [['“AI requests per month (override)”'], ['empty'], ['AI is off in this installation']],
  ], [3, 2, 4]);
  steps(['Click “Apply”. The card shows the plan and the status “active”, and no end date.'], true);
  p('To end the free period later, type a date in “Period end” and click “Apply”: after it, the school has a grace period (7 days), then moves to the Free plan.');

  // ------------------------------------------------------------ 9
  h1('9. Student accounts');
  box('warn', 'Check the condition about students’ data in section 1 before this step.');
  steps([
    'Once the platform admin has given the school “Student accounts (override)” (section 8.2), the school’s owner or one of its admins opens the “Students” page. It shows the “School code” and a counter such as “0 of 300 in use”.',
    '“Add student” → “Username” (Latin letters, digits, dots and hyphens, 3 to 40 characters), “Student’s name”, “Grade” and “Curriculum” → “Add student”.',
    '“Student passwords” appears once: write the password down or download it with “Download passwords (CSV)”. A new password can always be set later.',
    ['Give each student the school code, the username, the password and the sign-in address ', { c: `https://${DOMAIN}/student-login` }, '. The student types the “School code”, the “Username” and the “Password”, then “Sign in”.'],
  ]);
  p(['For many students: “Import CSV…” on the “Students” page, with the columns username, name, grade (1 to 12) and, optionally, scope, up to 300 students per file. Everything after that (classes, homework, tests and grades) is in the user guide inside the package: ', { c: 'docs/USER_GUIDE.md' }, '.']);
  box('ok', 'Adding a student, and the student’s sign-in with the school code, were run in the test (section 1).');

  // ------------------------------------------------------------ 10
  h1('10. Backups');
  h2('10.1 The first backup (by hand)');
  code(['cd /opt/midad', 'ops/backup.sh --env prod']);
  p('The script’s questions, in order:');
  table([['The question as it appears'], ['Recommended answer'], ['What it means']], [
    [[{ c: 'Include the settings file (...)? Needed to rebuild a lost server' }], [{ c: 'y' }], ['Adds the settings file to the backup (which is then always encrypted), so a lost server can be rebuilt from it']],
    [[{ c: 'Include the TLS certificates (Caddy)?' }], [{ c: 'y' }], ['Adds the HTTPS certificates']],
    [[{ c: 'Copy this backup to ... Numbers separated by commas, or 0 for none' }], ['The number of a place off the server: 1 a folder or disk, 2 another server (SFTP), 3 cloud storage'], ['The first time, it asks for the place’s connection details and tests them']],
    [[{ c: 'Use this choice by default next time?' }], [{ c: 'y' }], ['Keeps the choice for next time']],
    [[{ c: 'Delete backups older than how many days ... (0 = keep all)' }], ['Enter (30)'], ['Deletes backups older than 30 days']],
    [[{ c: 'Backup passphrase ... / Type it again' }], ['A long passphrase (at least 12 characters), twice'], ['Keep it in the password manager: without it the backup can never be opened']],
  ], [4, 3, 3]);
  p(['The backup is saved in ', { c: '/opt/midad/backups/' }, ' with a name such as ', { c: 'midad-backup-prod-20261107T092928Z.tar.enc' }, ', and in the place you chose.']);
  h2('10.2 Testing the backup');
  code(['cd /opt/midad', 'ops/restore.sh --env prod --only-verify']);
  p(['It asks where from and which backup, then the passphrase; it restores the backup into a temporary database, compares every table, then deletes it. Nothing in the installation changes. The expected result: ', { c: 'The backup can be restored.' }]);
  h2('10.3 Automatic daily backups');
  p('First, the passphrase file for scheduled backups, from the menu of backup places:');
  code(['cd /opt/midad', 'ops/midad.sh destinations']);
  p(['Choose ', { c: '4' }, ' (', { c: 'Passphrase file for scheduled backups' }, '), press Enter to accept the suggested path, type the same passphrase twice, then choose ', { c: '5' }, ' (', { c: 'Done' }, '). Then create the scheduled job (change the email on the second line, and replace ', { c: 'local' }, ' with ', { c: 'bucket' }, ', ', { c: 'server' }, ' or ', { c: 'folder' }, ' to match your place off the server):']);
  code([
    "cat > /etc/cron.d/midad <<'EOF'",
    'MAILTO=ops@example.com',
    '15 2 * * * root cd /opt/midad && ops/backup.sh --env prod --yes >>/var/log/midad-backup.log 2>&1 || echo "Midad backup failed: see /var/log/midad-backup.log"',
    '45 3 * * 0 root cd /opt/midad && ops/restore.sh --env prod --yes --from local --only-verify >>/var/log/midad-backup.log 2>&1 || echo "Midad backup test failed: see /var/log/midad-backup.log"',
    'EOF',
  ]);
  p('The first line takes a backup every day at 02:15; the second tests the latest backup every Sunday (server time). For an email on failure, the server needs a mail-sending program; otherwise read the log:');
  code(['tail -n 30 /var/log/midad-backup.log']);
  box('warn', ['Never schedule a restore without ', { c: '--only-verify' }, '. A real restore is explained in ', { c: 'docs/DEPLOYMENT_GUIDE.md' }, ' section 8.6.']);

  // ------------------------------------------------------------ 11
  h1('11. Monitoring and day-to-day operation');
  code(['cd /opt/midad', 'ops/status.sh --env prod'], 'Status (the services, readiness, and any known fault):');
  code(['cd /opt/midad', 'ops/stop.sh --env prod'], 'Stopping (it asks: 1 stop, 2 stop and remove the containers; the data stays either way):');
  code(['cd /opt/midad', 'ops/start.sh --env prod'], 'Starting:');
  code(['cd /opt/midad', `${DC} logs --tail 100 app app2 worker caddy`], 'Logs (the last 100 lines of each service):');
  code(['docker stats --no-stream'], 'Memory use:');
  bullet('After the server restarts, the services come back by themselves, unless you stopped them with the stop script.');
  bullet(['Add an external check (UptimeRobot, Better Stack or similar) of ', { c: `https://${DOMAIN}/readyz` }, ' every minute that alerts after two failures: nothing on the server can report that the server itself is down.']);
  bullet('The app’s alerts (the background worker stopped, email failing, server errors, the database unreachable, files waiting to be checked) go to ALERT_EMAILS: one email when an alert starts, a reminder every 6 hours, and one when it clears.');
  bullet('Update the operating system every month: apt update && apt upgrade -y, then restart the server if it asks for it.');

  // ------------------------------------------------------------ 12
  h1('12. Upgrading to a new release of the package');
  p(['Upload the new release’s file to ', { c: '/root/' }, ' (section 4), then (change the file name):']);
  code([
    'cd /opt/midad && ops/backup.sh --env prod',
    'cd /opt',
    'mv midad midad-previous',
    'unzip /root/midad-NEW.zip',
    'cp -p midad-previous/.env.production midad/',
    '[ -f midad-previous/.env.backup ] && cp -p midad-previous/.env.backup midad/',
    'mv midad-previous/backups midad/',
    'cd /opt/midad',
    'ops/start.sh --env prod',
  ]);
  p(['Answer ', { c: 'y' }, ' to ', { c: 'Rebuild the app image first (after updating the code)?' }, '. The database updates are applied by themselves, and the app stops for a few seconds. The data stays because the folder’s name has not changed. The previous image is kept as ', { c: 'midad:previous' }, ' to go back to it (', { c: 'docs/DEPLOYMENT_GUIDE.md' }, ' section 4).']);
  box('note', 'These steps were not run in this package’s test (section 1), although the upgrade and rollback scripts were tested on Docker before.');

  // ------------------------------------------------------------ 13
  h1('13. Troubleshooting');
  table([['What you see'], ['Cause and fix']], [
    [[{ c: 'Error: .env.production not found' }], ['The settings file was not created: section 5.1']],
    [[{ c: 'set these in .env.production first: ...' }], ['Required values are empty (the message names them): fill them in with the editor']],
    [[{ c: 'still has change-me values' }], ['The box in section 5.1 was not run in full']],
    [[{ c: 'APP_URL must start with https://' }], ['The first line of the box in 5.1 was not changed as it should be']],
    [[{ c: 'app is not ready after 3 minutes' }], ['Read the app’s log (section 11, “Logs”): its first error message names the wrong setting']],
    [['The browser warns about the certificate, or does not open the site'], ['DNS, or ports 80 and 443: sections 3.1 and 3.3, and Caddy’s log (section 6)']],
    [['The confirmation email does not arrive'], ['Check the SMTP values (section 5.2), then the background worker’s log (section 11, “Logs”). Emails wait and are retried by themselves']],
    [['“Student accounts are not turned on” on the Students page'], ['“Student accounts (override)” was not given: section 8.2']],
    [['A school cannot add more than 2 members or one scope'], ['Its 14 days are over and it is on the Free plan: section 8.2']],
    [['You forgot the platform admin’s password'], ['“Forgot password?” on the sign-in page (a link arrives by email)']],
    [['You lost the two-factor phone'], ['Sign in with one of the recovery codes from section 7.2']],
  ], [2, 3]);

  // ------------------------------------------------------------ 14
  h1('14. Checklist before schools start');
  for (const item of [
    [{ c: `https://${DOMAIN}` }, ' opens with a valid HTTPS padlock, and ', { c: `https://${DOMAIN}/readyz` }, ' answers ready'],
    'The settings file is in the password manager, with the backup passphrase',
    'The platform admin has a new password, two-factor authentication is on, and the recovery codes are kept',
    'The test alert reached the operations email, and a confirmation email reached a test school',
    'A first backup was taken and tested, with a copy off the server, and the scheduled job is written',
    ['An external uptime check is set on ', { c: `https://${DOMAIN}/readyz` }],
    'Every school has its plan with no end date, and its number of student accounts',
    'Written legal approval for students’ data, and each school’s consent, before any real student',
    'The privacy policy and how to reach support have been sent to the schools',
  ]) check(item);

  // ------------------------------------------------------------ 15
  h1('15. Appendix: what is in the installation');
  table([['Service'], ['What it does']], [
    [[{ c: 'caddy' }], ['The only one open to the internet (80 and 443): HTTPS and its certificates; it shares the requests between the two app instances']],
    [[{ c: 'app' }, ' and ', { c: 'app2' }], ['The two app instances; one can stop without the site stopping']],
    [[{ c: 'worker' }], ['The background worker: email, file checks, scheduled tasks and alerts']],
    [[{ c: 'postgres' }], ['The database (with the homework files), inside Docker only']],
    [[{ c: 'clamav' }], ['Scans homework files for viruses before anyone opens them']],
    [[{ c: 'migrate' }], ['Updates the database’s structure on every start, then stops']],
  ], [1, 4]);
  table([['File or folder'], ['What it holds'], ['Keep it?']], [
    [[{ c: '/opt/midad/.env.production' }], ['All settings and secrets'], ['Yes: in the password manager']],
    [[{ c: '/opt/midad/.env.backup' }], ['The backup places’ settings'], ['Yes: write its settings down somewhere else']],
    [[{ c: '/opt/midad/backups/' }], ['The local backups'], ['Copy it off the server (section 10)']],
    [['Docker’s volumes'], ['The database, the certificates and the virus signatures'], ['They stay when you stop and restart']],
  ], [3, 3, 3]);
  p(['References inside the package: the full deployment guide ', { c: 'docs/DEPLOYMENT_GUIDE.md' }, ' (secrets in files, a managed database, restoring, changing keys, memory sizes), the user guide ', { c: 'docs/USER_GUIDE.md' }, ', and the project status ', { c: 'docs/PROJECT_STATUS.md' }, '.']);

  return { title: 'Deploying Midad on a production server', header: 'Midad · Deployment guide · ', page: 'Page ', of: ' of ' };
}

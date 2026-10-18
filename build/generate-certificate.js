import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pfxPath = path.resolve(__dirname, 'yoru-reader.pfx');
const cerPath = path.resolve(__dirname, 'yoru-reader.cer');

if (fs.existsSync(pfxPath) && fs.existsSync(cerPath)) {
  console.log('[CertGen] Certificate and public key already exist. Importing to CertStore...');
  try {
    const importCmd = `$pass = ConvertTo-SecureString -String 'YoruReaderSecret123' -AsPlainText -Force; Import-PfxCertificate -FilePath '${pfxPath.replace(/'/g, "''")}' -CertStoreLocation 'Cert:\\CurrentUser\\My' -Password $pass`;
    execSync(`powershell -ExecutionPolicy Bypass -Command "${importCmd}"`, { stdio: 'ignore' });
  } catch (e) {}
  process.exit(0);
}

console.log('[CertGen] Generating self-signed code signing certificate...');
const tempScriptPath = path.resolve(__dirname, 'temp-gen-cert.ps1');

try {
  const psScriptContent = `
$pfxPath = '${pfxPath.replace(/'/g, "''")}'
$cerPath = '${cerPath.replace(/'/g, "''")}'

$pass = ConvertTo-SecureString -String 'YoruReaderSecret123' -AsPlainText -Force
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Yoru Cafe' -KeyUsage DigitalSignature -FriendlyName 'Yoru Reader' -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(10)
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pass
Export-Certificate -Cert $cert -FilePath $cerPath
Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation 'Cert:\\CurrentUser\\My' -Password $pass
`.trim();

  fs.writeFileSync(tempScriptPath, psScriptContent, 'utf8');

  execSync(`powershell -ExecutionPolicy Bypass -File "${tempScriptPath}"`, { stdio: 'inherit' });
  console.log('[CertGen] Certificate files created successfully:');
  console.log(`  PFX: ${pfxPath}`);
  console.log(`  CER: ${cerPath}`);
} catch (error) {
  console.error('[CertGen] Failed to generate self-signed certificate:', error.message);
  process.exit(1);
} finally {
  if (fs.existsSync(tempScriptPath)) {
    try {
      fs.unlinkSync(tempScriptPath);
    } catch (e) {
      console.warn('[CertGen] Failed to clean up temporary script file:', e.message);
    }
  }
}

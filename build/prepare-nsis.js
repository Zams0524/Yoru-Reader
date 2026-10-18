import fs from 'fs';
import path from 'path';

const source = path.resolve('build/assistedInstaller.nsh');
const target = path.resolve('node_modules/app-builder-lib/templates/nsis/assistedInstaller.nsh');

try {
  if (fs.existsSync(source)) {
    // Asegurar que el directorio de destino existe (debería existir si node_modules está instalado)
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.copyFileSync(source, target);
    console.log('Successfully copied custom assistedInstaller.nsh to app-builder-lib templates.');
  } else {
    console.error('Error: build/assistedInstaller.nsh does not exist.');
    process.exit(1);
  }
} catch (error) {
  console.error('Error copying NSIS template:', error);
  process.exit(1);
}

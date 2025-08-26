const express = require('express');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

/**
 * Varmistaa että upload-kansio on olemassa
 * Jos kansiota ei ole, luo se rekursiivisesti
 */
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * Listaa kansion sisältämät tiedostot ja kansiot
 * @param baseDir polku kansioon joka listataan
 * @return taulukko objekteista jotka sisältävät nimen ja tyypin (tiedosto/kansio)
 */
function listDirectory(baseDir) {
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  return entries.map(e => ({
    name: e.name,
    isDirectory: e.isDirectory()
  }));
}

/**
 * Ratkaisee suhteellisen polun turvallisesti
 * Estää polkutraversal-hyökkäykset ja varmistaa että polku on UPLOAD_DIR:n alla
 * @param relPath suhteellinen polku joka ratkaistaan
 * @return turvallinen absoluuttinen polku tai null jos polku ei ole turvallinen
 */
function resolveSafe(relPath) {
  /**
   * Estää polkutraversal-hyökkäykset - ei salli ja varmistaa että ratkaistu polku on UPLOAD_DIR:n alla
   */
  if (!relPath) return UPLOAD_DIR;
  /**
   * Normalisoi ja poistaa etulevät viivat
   */
  const cleaned = path.normalize(relPath).replace(/^([/\\])+/, '');
  if (cleaned.includes('..')) return null;
  const resolved = path.join(UPLOAD_DIR, cleaned);
  if (!resolved.startsWith(UPLOAD_DIR)) return null;
  return resolved;
}

/**
 * Kotisivu - listaa kansiot ja tiedostot (juuri)
 * @param req Express request objekti
 * @param res Express response objekti
 */
router.get('/', (req, res) => {
  try {
    const items = listDirectory(UPLOAD_DIR);
    res.render('index', { items, currentPath: '' });
  } catch (err) {
    res.status(500).render('error', { error: 'Unable to scan files' });
  }
});

/**
 * Luo uuden kansion
 * @param req Express request objekti joka sisältää kansion nimen
 * @param res Express response objekti
 */
router.post('/folder', (req, res) => {
  const name = req.body.name;
  if (!name) return res.status(400).send('Folder name required');
  /**
   * Sanitoidaan kansion nimi turvallisuuden vuoksi
   */
  const safe = resolveSafe(name);
  if (!safe) return res.status(400).send('Invalid folder name');
  if (!fs.existsSync(safe)) {
    fs.mkdirSync(safe, { recursive: true });
  }
  res.redirect('/');
});

/**
 * Lataa tiedoston (valinnallisesti tiettyyn kansioon)
 * @param req Express request objekti joka sisältää tiedoston
 * @param res Express response objekti
 */
router.post('/upload', (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).send('No file was uploaded.');
  }
  const folder = req.body.folder || req.query.folder;
  const destDir = folder ? resolveSafe(folder) : UPLOAD_DIR;
  if (!destDir || (folder && !fs.existsSync(destDir))) {
    return res.status(400).send('Target folder does not exist or invalid');
  }

  const file = req.files.file;
  const filePath = path.join(destDir, file.name);

  file.mv(filePath, (err) => {
    if (err) {
      return res.status(500).send(err);
    }
    /**
     * Ohjataan kansionäkymään jos tiedosto ladattiin kansioon
     */
    if (folder) return res.redirect(`/folder/${encodeURIComponent(folder)}`);
    res.redirect('/');
  });
});

/**
 * Lataa yksittäisen tiedoston
 * Tukee sisäkkäisiä polkuja wildcard-parametrilla
 * @param req Express request objekti
 * @param res Express response objekti
 */
router.get('/download/*', (req, res) => {
  /**
   * Kaikki /download/ jälkeen tuleva
   */
  const rel = req.params[0];
  const safe = resolveSafe(rel);
  if (!safe || !fs.existsSync(safe) || fs.statSync(safe).isDirectory()) {
    return res.status(404).send('File not found');
  }
  res.download(safe);
});

/**
 * API: palauttaa kansion sisällön JSON-muodossa paikallaan tapahtuvaa laajennusta varten
 * @param req Express request objekti joka sisältää polun parametrin
 * @param res Express response objekti
 */
router.get('/api/folder', (req, res) => {
  const rel = req.query.path || '';
  const folderPath = resolveSafe(rel);
  if (!folderPath || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    return res.status(404).json({ error: 'Folder not found' });
  }
  try {
    const items = listDirectory(folderPath);
    res.json({ items, path: rel });
  } catch (err) {
    res.status(500).json({ error: 'Unable to read folder' });
  }
});

/**
 * Lataa kansion ZIP-tiedostona
 * @param req Express request objekti joka sisältää kansion nimen
 * @param res Express response objekti
 */
router.get('/download-folder/:folder', (req, res) => {
  const folder = req.params.folder;
  const folderPath = resolveSafe(folder);
  if (!folderPath || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    return res.status(404).send('Folder not found');
  }

  const zip = new AdmZip();
  zip.addLocalFolder(folderPath, folder);
  const zipBuffer = zip.toBuffer();

  /**
   * Puhdistetaan ja koodataan kansion nimi turvalliseksi header-käyttöön
   */
  const safeFilename = folder.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${safeFilename}.zip"`);
  res.send(zipBuffer);
});

/**
 * Poistaa tiedoston tai kansion
 * @param req Express request objekti joka sisältää poistettavan kohteen
 * @param res Express response objekti
 */
router.post('/delete', (req, res) => {
  const target = req.body.target;
  if (!target) return res.status(400).send('Target required');
  const safe = resolveSafe(target);
  if (!safe || !fs.existsSync(safe)) return res.status(404).send('Not found');
  const stat = fs.statSync(safe);
  try {
    if (stat.isDirectory()) {
      fs.rmSync(safe, { recursive: true, force: true });
    } else {
      fs.unlinkSync(safe);
    }
    /**
     * Jos poisto tapahtui kansiossa, ohjataan takaisin siihen kansioon
     */
    const parent = path.dirname(path.relative(UPLOAD_DIR, safe));
    if (parent && parent !== '.') return res.redirect(`/folder/${encodeURIComponent(parent)}`);
    res.redirect('/');
  } catch (err) {
    res.status(500).send('Delete failed');
  }
});

/**
 * Selaa kansion sisältöä
 * @param req Express request objekti joka sisältää kansion nimen
 * @param res Express response objekti
 */
router.get('/folder/:name', (req, res) => {
  const name = req.params.name;
  const folderPath = resolveSafe(name);
  if (!folderPath || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    return res.status(404).render('error', { error: 'Folder not found' });
  }
  try {
    const items = listDirectory(folderPath);
    res.render('index', { items, currentPath: name });
  } catch (err) {
    res.status(500).render('error', { error: 'Unable to scan folder' });
  }
});

module.exports = router;

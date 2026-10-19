/**
 * Sec-MS-GEC v2 token for Microsoft Edge's read-aloud service.
 *
 * Since late 2025 the service rejects the old SHA-256 token (HTTP 403). This is a port of
 * edge-tts' drm.py (github.com/rany2/edge-tts, generate_sec_ms_gec_v2): a modified SHA-256
 * plus a "CS64" digest, formatted "<16 hex>-<64 hex>". BigInt keeps the arithmetic identical
 * to the Python original, which relies on unbounded integers masked to 32 bits.
 */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600;

const M = 0xFFFFFFFFn;
const u32 = (x) => BigInt.asUintN(32, x);

const SHA256_INITIAL = [0x6A09E667n, 0xBB67AE85n, 0x3C6EF372n, 0xA54FF53An, 0x510E527Fn, 0x9B05688Cn, 0x1F83D9ABn, 0x5BE0CD19n];
const SHA256_STATE = [0xFD9FBEA2n, 0x91243CE7n, 0xBE499094n, 0xCD2E1E0An, 0x6C006F49n, 0x04BD35ABn, 0xFEB0A7E4n, 0x03EFFBD2n];
const SHA256_SCHEDULE = [
  0xEB24BF9En, 0x1558691Fn, 0xA0C09EE2n, 0x0CFA32BAn, 0xA622EE8Cn, 0xD1DD9491n, 0xC0DD25A0n,
  0xF9E70AB6n, 0xF0C31573n, 0x7058CE4En, 0x7188E606n, 0x00E5AB33n, 0xD258B060n, 0x72766564n,
];
const K = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
].map(BigInt);
const SHA256_ADJUSTMENT = 0xC9DC06A7n;
const BLOCK_K = [...K.slice(0, 14), SHA256_ADJUSTMENT, ...K.slice(15)];
const SIGMA0_ADJ = 0x059C0B80n;
const SIGMA1_ADJ = 0x000B92C0n;

const CS64_COEFFICIENTS = [
  [0xE82E91B1n, 0xB32700D0n], [0x44DE24C6n, 0x88DFF51Dn], [0x3BEB65BCn, 0x29514038n],
  [0xC89C5933n, 0xB328CBDFn], [0x8D1EC211n, 0xD405B4D5n], [0x314EF5D5n, 0x26E55F3Cn],
  [0xE92491B1n, 0x607801C6n], [0xF0A5B9D5n, 0x82B2C1FBn], [0x06064CF3n, 0xFA51A3DAn],
  [0xDA79FA60n, 0x207CC464n], [0xBED20560n, 0x3C3C74F3n], [0x89F9C9F8n, 0xD2D14B61n],
  [0x35FA38C6n, 0xBB04A2C1n], [0xCB49E3C6n, 0xC5626167n],
];
const CS64_FACTOR = 0x82893933n;
const CS64_ADJ0 = 0xF2F90B1An;
const CS64_ADJ1 = 0x0B1A0000n;

const rol16 = (v) => { v = u32(v); return u32((v << 16n) | (v >> 16n)); };
const sigma0 = (v) => u32((v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n));
const sigma1 = (v) => u32((v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n));
const ROT = 0x100000001n;
const bigSigma1 = (e) => { const r = e * ROT; return (r >> 6n) ^ (r >> 11n) ^ (r >> 25n); };
const bigSigma0 = (a) => { const r = a * ROT; return (r >> 2n) ^ (r >> 13n) ^ (r >> 22n); };

function sha256Rounds(state, words, firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  const constants = firstRound === 14 ? BLOCK_K : K;
  // Plain SHA-256 round structure (the Python unrolls it eight rounds at a time).
  for (let i = firstRound; i < 64; i++) {
    const t1 = h + (bigSigma1(e) & M) + (g ^ (e & (f ^ g))) + constants[i] + words[i];
    const t2 = (bigSigma0(a) & M) + ((a & b) | (c & (a | b)));
    h = g; g = f; f = e; e = u32(d + t1); d = c; c = b; b = a; a = u32(t1 + t2);
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(words, firstWord = 16) {
  for (let i = firstWord; i < 64; i++) {
    const x = words[i - 2];
    const y = words[i - 15];
    const s1 = (x >> 17n) ^ (x << 15n) ^ (x >> 19n) ^ (x << 13n) ^ (x >> 10n);
    const s0 = (y >> 7n) ^ (y << 25n) ^ (y >> 18n) ^ (y << 14n) ^ (y >> 3n);
    words.push(u32(s1 + words[i - 7] + s0 + words[i - 16]));
  }
}

const beInt = (bytes) => bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

function sha256Init(data7) {
  const words = [...Array(14).fill(0n), beInt(data7.subarray(0, 3)), beInt(data7.subarray(3, 7))];
  for (let i = 16; i < 30; i++) {
    let value = SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) value += i === 16 ? (sigma1(words[i - 2]) ^ SIGMA1_ADJ) : sigma1(words[i - 2]);
    if (i - 7 >= 14) value += words[i - 7];
    if (i - 15 >= 14) value += i === 29 ? (sigma0(words[i - 15]) ^ SIGMA0_ADJ) : sigma0(words[i - 15]);
    words.push(u32(value));
  }
  words.push(u32(sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - K[14]));
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((x, i) => u32(x + working[i]));
}

function sha256Digest(data) {
  if (data.length < 7) throw new Error('Token salt must contain at least seven bytes');
  const length = 57 + data.length;
  const zeros = (((55 - length) % 64) + 64) % 64;
  const tail = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(zeros), Buffer.alloc(8)]);
  tail.writeBigUInt64BE(BigInt(length * 8), tail.length - 8);
  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < tail.length; offset += 64) {
    const words = [];
    for (let j = 0; j < 16; j++) words.push(BigInt(tail.readUInt32BE(offset + j * 4)));
    expandSchedule(words);
    const working = sha256Rounds(state, words);
    state = state.map((x, i) => u32(x + working[i]));
  }
  const out = Buffer.alloc(32);
  state.forEach((x, i) => out.writeUInt32BE(Number(x), i * 4));
  return out;
}

function wordsLe4Even(data) {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const words = [];
  for (let i = 0; i < padded.length; i += 4) words.push(BigInt(padded.readUInt32LE(i)));
  if (words.length % 2) words.push(0n);
  return words;
}

function cs64Digest(data, digest) {
  let keyA = BigInt(digest.readUInt32LE(0)) | 1n;
  let keyB = BigInt(digest.readUInt32LE(4)) | 1n;
  const factors = [u32(keyA * CS64_FACTOR), u32(keyB * CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([coefficient], i) => u32(coefficient * factors[i % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);
  wordsLe4Even(Buffer.concat([Buffer.from([0]), data])).forEach((word, i) => {
    let term = word * (i % 2 === 0 ? keyA : keyB);
    let offset = rol16(word) * (i % 2 === 0 ? 0xEF0569FBn : 0xC31713DBn);
    if (i === 0) {
      term += CS64_ADJ0 * factors[0];
      offset += CS64_ADJ1;
    }
    terms.push(u32(term));
    offsets.push(u32(offset));
  });
  let swapAcc = 0n, swapLast = 0n, state = 0n, acc = 0n;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i];
    const y = terms[i + 1];
    let t = rol16(u32(offsets[i] + x));
    let q = u32(t * 0x76F50F34n);
    swapAcc += u32(rol16(q) * 0xC3EFEA97n + q);
    t = rol16(u32(offsets[i + 1] + y));
    q = u32(t * 0x1881CE3Cn);
    swapLast = u32(rol16(q) * 0x35BD1EC9n + q);
    swapAcc = u32(swapAcc + swapLast);

    state = u32(state * keyA + x);
    state = u32(rol16(state) * 0xCF98B111n);
    state = u32(rol16(state) * 0x87085B9Fn);
    state = u32(rol16(state) * 0x12CEB96Dn);
    state = u32(rol16(state) * 0x257E1D83n);
    acc += state;
    t = u32(state * keyB + y);
    t = u32(rol16(t) * 0xA27416F5n);
    t = u32(rol16(t) * 0xD38396FFn);
    state = u32(rol16(u32(rol16(t) * 0x7C932B89n)) * 0xBFA49F69n);
    acc = u32(acc + state);
  }
  return [u32(swapLast ^ state), u32(swapAcc ^ acc)];
}

/** Sec-MS-GEC v2 for the given Unix time in seconds (defaults to now). */
function generateSecMsGecV2(unixSeconds = Date.now() / 1000) {
  let seconds = Math.floor(unixSeconds + WIN_EPOCH);
  seconds -= seconds % 300;
  const ticks = BigInt(seconds) * 10000000n;
  const data = Buffer.from(`${ticks}${TRUSTED_CLIENT_TOKEN}`, 'ascii');
  const digest = sha256Digest(data);
  const [c0, c1] = cs64Digest(data, digest);
  const cs64 = Buffer.alloc(8);
  cs64.writeUInt32LE(Number(c0), 0);
  cs64.writeUInt32LE(Number(c1), 4);
  return `${cs64.toString('hex').toUpperCase()}-${digest.toString('hex').toUpperCase()}`;
}

module.exports = { generateSecMsGecV2, TRUSTED_CLIENT_TOKEN };

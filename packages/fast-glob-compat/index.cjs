// eslint-disable-next-line @typescript-eslint/no-require-imports -- The inspected build-tool callers require a CommonJS entry point.
const tinyglobby = require('tinyglobby');

const allowedOptions = new Set([
  'cwd', 'onlyDirectories', 'onlyFiles', 'ignore', 'absolute', 'dot', 'followSymbolicLinks',
]);

function checkedPatterns(value) {
  const patterns = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(patterns) || patterns.length > 256) {
    throw new TypeError('Expected a string or at most 256 glob patterns');
  }
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') throw new TypeError('Glob patterns must be strings');
    if (pattern.length > 4096 || (pattern.match(/[{}()]/g) || []).length > 128) {
      throw new RangeError('Glob pattern exceeds the build adapter complexity limit');
    }
  }
  return patterns;
}

function checkedOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Glob options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (!allowedOptions.has(key)) throw new TypeError(`Unsupported build glob option: ${key}`);
  }
  if (options.ignore !== undefined) checkedPatterns(options.ignore);
  // fast-glob does not recursively expand a bare directory pattern.
  return {...options, expandDirectories: false};
}

async function glob(patterns, options) {
  return normalizeResults(await tinyglobby.glob(checkedPatterns(patterns), checkedOptions(options)));
}

function globSync(patterns, options) {
  return normalizeResults(tinyglobby.globSync(checkedPatterns(patterns), checkedOptions(options)));
}

function normalizeResults(files) {
  // tinyglobby marks directories with '/', unlike fast-glob's default output.
  return files.map(file => file.endsWith('/') && file !== '/' && !/^[a-z]:\/$/i.test(file)
    ? file.slice(0, -1) : file);
}

module.exports = glob;
module.exports.glob = glob;
module.exports.sync = globSync;
module.exports.globSync = globSync;

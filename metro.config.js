// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { FlattenMap, encodedMappings } = require('@jridgewell/trace-mapping');

const config = getDefaultConfig(__dirname);

/**
 * Metro serves source maps as indexed maps ("sections"), which the dev menu's Source Map Explorer cannot decode.
 * For requests from the app itself (iOS URLSession, "CFNetwork" user agent), flatten them into a plain map.
 * Browser tools (the JS debugger) keep the original response.
 */
function flattenSourceMaps(middleware) {
  return (req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (!path.endsWith('.map') || !/CFNetwork/.test(req.headers['user-agent'] || '')) {
      return middleware(req, res, next);
    }
    const chunks = [];
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    const collect = (chunk, encoding) => {
      if (chunk != null && typeof chunk !== 'function') {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
      }
    };
    res.write = (chunk, encoding) => {
      collect(chunk, encoding);
      return true;
    };
    res.end = (chunk, encoding) => {
      collect(chunk, encoding);
      let body = Buffer.concat(chunks);
      if (res.statusCode === 200) {
        try {
          const raw = JSON.parse(body.toString('utf8'));
          if (raw.sections) {
            const map = new FlattenMap(raw);
            const flat = { version: 3, sources: map.sources, sourcesContent: map.sourcesContent, names: map.names, mappings: encodedMappings(map) };
            body = Buffer.from(JSON.stringify(flat));
          }
        } catch {
          // Not JSON or not flattenable: send it as it is.
        }
      }
      if (!res.headersSent) res.setHeader('Content-Length', body.length);
      write(body);
      return end();
    };
    return middleware(req, res, next);
  };
}

const enhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const base = enhance ? enhance(middleware, server) : middleware;
  return flattenSourceMaps(base);
};

module.exports = config;

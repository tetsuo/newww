var P = require('bluebird');
var Hapi = require('hapi');
var path = require('path');
var redisConfig = require("redis-url").parse(process.env.REDIS_URL);
var parseTime = require('timeparse');

module.exports = makeServer;

function makeServer(config) {
  return P.resolve().then(function() {
    var server = new Hapi.Server({
      cache: {
        engine: require('catbox-redis'),
        host: redisConfig.hostname,
        port: redisConfig.port,
        password: redisConfig.password,
      },
      connections: {
        router: {
          stripTrailingSlash: true
        },
        routes: {
          security: {
            hsts: {
              maxAge: parseTime('3w3d'),
              includeSubdomains: true
            },
            xframe: true
          }
        }
      }
    });

    server.connection(config.connection);

    server.stamp = require("./stamp")();
    server.gitHead = require("./git-head")();

    // configure http request cache
    require("./cache").configure({
      redis: process.env.REDIS_URL,
      ttl: 500,
      prefix: "cache:"
    });

    return P.promisify(server.register, server)(require('hapi-auth-cookie')).then(function() {
      var cache = server.cache({
        expiresIn: parseTime('2w'),
        segment: '|sessions'
      });

      server.app.cache = cache;

      server.auth.strategy('session', 'cookie', 'required', {
        password: process.env.SESSION_PASSWORD,
        appendNext: 'done',
        redirectTo: '/login',
        cookie: process.env.SESSION_COOKIE,
        clearInvalid: true,
        validateFunc: function(session, cb) {
          cache.get(session.sid, function(err, item, cached) {

            if (err) {
              return cb(err, false);
            }
            if (!cached) {
              return cb(null, false);
            }

            return cb(null, true, item);
          });
        }
      });

    }).then(function() {
      var plugins = require('./../adapters/plugins');

      return P.promisify(server.register, server)(plugins).then(function() {
        server.views({
          engines: {
            hbs: require('handlebars')
          },
          relativeTo: path.resolve(__dirname, '..'),
          path: './templates',
          helpersPath: './templates/helpers',
          layoutPath: './templates/layouts',
          partialsPath: './templates/partials',
          layout: 'default'
        });

        server.route(require('./../routes/index'));
      }).then(function() {
        return P.promisify(server.start, server)();
      }).then(function() {
        return server;
      });
    });
  });
}

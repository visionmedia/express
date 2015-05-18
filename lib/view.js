/**
 * Module dependencies.
 */

var debug = require('debug')('express:view');
var path = require('path');
var fs = require('fs');
var utils = require('./utils');

/**
 * Module variables.
 * @private
 */

var dirname = path.dirname;
var basename = path.basename;
var extname = path.extname;
var join = path.join;
var resolve = path.resolve;

/**
 * Expose `View`.
 */

module.exports = View;

/**
 * Initialize a new `View` with the given `name`.
 *
 * Options:
 *
 *   - `defaultEngine` the default template engine name
 *   - `engines` template engine require() cache
 *   - `root` root path for view lookup
 *
 * @param {String} name
 * @param {Object} options
 * @api private
 */

function View(name, options) {
  options = options || {};
  this.name = name;
  this.root = options.root;
  var engines = options.engines;
  this.defaultEngine = options.defaultEngine;
  var ext = this.ext = extname(name);
  if (!ext && !this.defaultEngine) throw new Error('No default engine was specified and no extension was provided.');
  if (!ext) name += (ext = this.ext = ('.' != this.defaultEngine[0] ? '.' : '') + this.defaultEngine);
  this.engine = engines[ext] || (engines[ext] = require(ext.slice(1)).__express);
}

/**
 * Lookup view by the given `name` and `ext`
 *
 * @param {String} name
 * @param {String} ext
 * @param {Function} cb
 * @api private
 */

View.prototype.lookup = function lookup(name, ext, cb) {
  var roots = [].concat(this.root);

  debug('lookup "%s"', name);

  function lookup(roots, callback) {
    var root = roots.shift();
    if (!root) {
      return callback(null, null);
    }
    debug("looking up '%s' in '%s' with ext '%s'", name, root, ext);

    // resolve the path
    var loc = resolve(root, name);
    var dir = dirname(loc);
    var file = basename(loc);

    // resolve the file
    resolveView(dir, file, ext, function (err, resolved) {
      if (err) {
        return callback(err);
      } else if (resolved) {
        return callback(null, resolved);
      } else {
        return lookup(roots, callback);
      }
    });

  }

  return lookup(roots, cb);
};

/**
 * Render with the given `options` and callback `fn(err, str)`.
 *
 * @param {Object} options
 * @param {Function} fn
 * @api private
 */

View.prototype.render = function render(options, fn) {
  debug('render "%s"', this.path);
  if (!this.path) return fn(new Error("View has not been fully initialized yet"));
  this.engine(this.path, options, fn);
};

/** Resolve the main template for this view
 *
 * @param {function} cb
 * @private
 */
View.prototype.lookupMain = function lookupMain(cb) {
  if (this.path) return cb();
  var view = this;
  var name = path.extname(this.name) == this.ext
    ? this.name
    : this.name + this.ext;
  this.lookup(name, this.ext, function (err, path) {
    if (err) {
      return cb(err);
    } else if (!path) {
      var dirs = Array.isArray(view.root) && view.root.length > 1
        ? 'directories "' + view.root.slice(0, -1).join('", "') + '" or "' + view.root[view.root.length - 1] + '"'
        : 'directory "' + view.root + '"'
      var viewError = new Error('Failed to lookup view "' + view.name + '" in views ' + dirs);
      viewError.view = view;
      return cb(viewError);
    } else {
      view.path = path;
      cb();
    }
  });
};

/**
 * Resolve the file within the given directory.
 *
 * @param {string} dir
 * @param {string} file
 * @param {string} ext
 * @param {function} cb
 * @private
 */

function resolveView(dir, file, ext, cb) {
  var path;

  // <path>.<ext>
  path = join(dir, file);
  limitStat(path, function (err, stat) {
    if (err && err.code != 'ENOENT') {
      return cb(err);
    } else if (!err && stat && stat.isFile()) {
      return cb(null, path);
    }

    // <path>/index.<ext>
    path = join(dir, basename(file, ext), 'index' + ext);
    limitStat(path, function (err, stat) {
      if (err && err.code == 'ENOENT') {
        return cb(null, null);
      } else if (!err && stat && stat.isFile()) {
        return cb(null, path);
      } else {
        return cb(err || new Error("error looking up '" + path + "'"));
      }
    });
  });
}

var pendingStats = [];
var numPendingStats = 0;
/**
 * an fs.stat call that limits the number of outstanding requests to 10.
 *
 * @param {String} path
 * @param {Function} cb
 */
function limitStat(path, cb) {
  if (++numPendingStats > 10) {
    pendingStats.push([path, cb]);
  } else {
    fs.stat(path, cbAndDequeue(cb));
  }

  function cbAndDequeue(cb) {
    return function (err, stat) {
      cb(err, stat);
      var next = pendingStats.shift();
      if (next) {
        fs.stat(next[0], cbAndDequeue(next[1]));
      } else {
        numPendingStats--;
      }
    }
  }
}

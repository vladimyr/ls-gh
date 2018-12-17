'use strict';

const $ = require('cheerio');
const debug = require('debug')('client');
const got = require('got');
const Path = require('path');
const pkg = require('./package.json');

const PATH_SEPARATOR = '/';

const reGithub = /^(?:https?:\/\/)?github\.com\/?/;
const request = got.extend({
  baseUrl: 'https://github.com',
  headers: {
    'accept-encoding': 'gzip',
    'content-type': 'text/xml; charset=utf-8',
    'user-agent': `${pkg.config.ua} (${pkg.name}/${pkg.version})`
  }
});

const after = (str, substr) => str.indexOf(substr) + substr.length;
const isHttpError = err => err instanceof request.HTTPError;
const isPlain = type => type.trim().startsWith('text/plain');
const prop = (name, ns = 'DAV:') => `<${name} xmlns="${ns}"/>`;
const template = (props = []) => `
<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop>${props.map(it => prop(it.name || it, it.ns)).join('\n')}</prop>
</propfind>`;

class GithubError extends Error {
  static isGithubError(err) {
    return err instanceof this;
  }
}

module.exports = async function list(query, { branch } = {}) {
  const { owner, repo, path } = parse(query);
  branch = branch ? `branches/${branch}` : 'trunk';
  const url = `${owner}/${repo}.git/${branch}/${path}`;
  debug('url: %s', url);
  const props = [
    { name: 'creator-displayname', alias: 'author' },
    { name: 'creationdate', alias: 'createdAt' },
    { name: 'getcontentlength', alias: 'size' },
    { name: 'resourcetype', alias: 'type' }
  ];
  const parsers = {
    creationdate: $el => new Date($el.text()),
    getcontentlength: $el => parseInt($el.text(), 10),
    resourcetype($el) {
      const child = $el.children().get(0);
      return child && child.tagName.split(':')[1];
    }
  };
  const aliases = props.reduce((acc, { name, alias }) => {
    return Object.assign(acc, { [name]: alias });
  }, {});
  try {
    const resp = await request(url, {
      method: 'PROPFIND',
      headers: { Depth: 1 },
      body: template(props)
    });
    const items = toJSON(resp.body, { aliases, parsers });
    return process(items, path);
  } catch (err) {
    if (!isHttpError(err)) throw err;
    if (isPlain(err.response.headers['content-type'])) {
      throw new GithubError(err.response.body);
    }
    if (err.statusCode === 404) {
      throw new GithubError(`No such file or directory: ${path}`);
    }
    throw err;
  }
};

module.exports.GithubError = GithubError;

function toJSON(xml, { aliases = {}, parsers = {} } = {}) {
  const $xml = $(xml, { xmlMode: true });
  return $xml.find('D\\:response').map((_, el) => {
    const $response = $(el);
    const path = $response.find('D\\:href').text();
    const props = {};
    const $props = $response.find('D\\:propstat > D\\:prop').first().children();
    $props.each((_, el) => {
      const [, prop] = el.tagName.split(':');
      const parser = parsers[prop] || ($el => $el.text());
      const key = aliases[prop] || prop;
      const value = parser($(el));
      if (value) props[key] = value;
    });
    return Object.assign(props, { path });
  }).get();
}

function process(items, path) {
  const paths = new Set();
  return items.reduce((acc, item) => {
    item.path = normalize(item.path);
    if (!item.path || paths.has(item.path)) return acc;
    paths.add(item.path);
    if (isSame(item.path, path)) item.root = true;
    item.name = Path.basename(item.path);
    acc.push(item);
    return acc;
  }, []);
}

function normalize(path, seperator = PATH_SEPARATOR) {
  let start = -1;
  if (path.includes('branches')) {
    start = path.indexOf(seperator, after(path, 'branches') + 1);
  } else if (path.includes('trunk')) {
    start = path.indexOf(seperator, after(path, 'trunk'));
  }
  start += 1;
  return start && path.substr(start);
}

function parse(url, separator = PATH_SEPARATOR) {
  url = url.replace(reGithub, '');
  const [owner, repo, ...segments] = url.split(separator);
  return { owner, repo, path: segments.join(separator) };
}

function isSame(path1, path2) {
  return Path.resolve(Path.sep, path1) === Path.resolve(Path.sep, path2);
}

#!/usr/bin/env node

'use strict';

const fecha = require('fecha');
const kleur = require('kleur');
const list = require('./');
const pkg = require('./package.json');
const prettyBytes = require('pretty-bytes');
const { table, getBorderCharacters } = require('table');

const { GithubError } = list;
// NOTE: Copied from bili (by @egoist): https://git.io/fxupU
const supportsEmoji = process.platform !== 'win32' ||
                      process.env.TERM === 'xterm-256color';

const emoji = char => supportsEmoji ? `${char}  ` : '';
const formatError = msg => msg.replace(/^\w*Error:\s+/, match => kleur.red().bold(match));
const logError = msg => console.error('%s%s', emoji('🚨'), msg);

const isDirectory = item => item.type === 'collection';
const formatType = item => isDirectory(item) ? 'd' : ' ';
const formatDate = item => fecha.format(item.createdAt, 'MMM DD HH:mm');

const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    v: 'version',
    h: 'help',
    b: 'branch',
    j: 'json'
  },
  boolean: ['version', 'help', 'json'],
  string: ['branch']
});

const help = `
  ${kleur.bold(pkg.name)} v${pkg.version}

  Usage:
    $ ${pkg.name} <path>              # list remote items
    $ ${pkg.name} <path> -b <branch>  # list remote items on target branch

  Options:
    -b, --branch   List items from specified git branch
    -j, --json     Output list in JSON format
    -h, --help     Show help
    -v, --version  Show version number

  Homepage:     ${kleur.green(pkg.homepage)}
  Report issue: ${kleur.green(pkg.bugs.url)}
`;

program(argv._, argv).catch(err => logError(formatError(err.stack)));

async function program([path], flags) {
  if (flags.version) return console.log(pkg.version);
  if (flags.help) return console.log(help);
  if (!path) return logError(formatError('Error: Github path required!'));
  try {
    const items = await list(path, { branch: flags.branch });
    if (flags.json) return console.log(JSON.stringify(items, null, 2));
    print(items);
  } catch (err) {
    if (!GithubError.isGithubError(err)) throw err;
    return logError(formatError(`Error: ${err.message}`));
  }
}

function print(items) {
  const data = items.map(item => [
    formatType(item),
    item.author,
    formatSize(item),
    formatDate(item),
    formatLabel(item)
  ]);
  const columns = {
    0: { width: 1, paddingRight: 2 },
    1: { paddingRight: 3 },
    2: { alignment: 'right' }
  };
  console.log(printList(data, { columns }));
}

function formatSize(item) {
  if (!item.size) return ' ';
  return prettyBytes(item.size)
    .toUpperCase().replace(/\s/g, '')
    .replace(/[A-Z]+$/g, ([letter]) => letter);
}

function formatLabel(item, separator = '/') {
  if (item.root && isDirectory(item)) return '.';
  return isDirectory(item) ? item.name + separator : item.name;
}

function printList(data, options) {
  return table(data, {
    border: getBorderCharacters('void'),
    columnDefault: { paddingLeft: 0, paddingRight: 1 },
    drawHorizontalLine: () => false,
    ...options
  }).trimRight();
}

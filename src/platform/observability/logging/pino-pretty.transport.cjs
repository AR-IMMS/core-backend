'use strict';

const pinoPretty = require('pino-pretty');

function formatMessage(log, messageKey, _levelLabel, { colors }) {
  const context = typeof log.context === 'string' ? log.context : 'HTTP';
  const message = String(log[messageKey] ?? '');

  return `${colors.bold(colors.cyan(context))} | ${colors.white(message)}`;
}

function createPrettyTransport(options) {
  return pinoPretty({ ...options, messageFormat: formatMessage });
}

module.exports = createPrettyTransport;
module.exports.formatMessage = formatMessage;

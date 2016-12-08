'use strict';

var Q = require('q');
var _ = require('lodash');

var config = require('../../config');
var logger = config.logger;

var cliHelpers = require('../helpers');

module.exports = function(program) {
	program.command('lint')
		.arguments('<environment>')
		.description('lint the combined manifest and environment file for required settings')
		.action(function(environment) {
			var runtimeOptions = this.opts();
			runtimeOptions.environment = environment;
			Q.when(runtimeOptions)
			.then(cliHelpers.setup())
			.then(cliHelpers.lint)
			.catch(function(err) {
				logger.error(err.message);
			});
		});
};

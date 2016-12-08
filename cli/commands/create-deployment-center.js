'use strict';

var Q = require('q');
var _ = require('lodash');

var config = require('../../config');
var logger = config.logger;

var cliHelpers = require('../helpers');
var deploymentTasks = require('../../lib/deployment-tasks');

var deploymentCenter = require('../../deployment-center');

module.exports = function(program) {
	program.command('create-deployment-center')
		.arguments('<name>')
		.description('creates a deployment center with the given name')
		.option('--region <aws-region>', 'AWS Region to create the deployment center resources in')
		.action(function(name) {

			var region = this.region;

			if(!region) {
				logger.error('A region for the deployment center must be specified');
				this.help();
			}

			deploymentCenter.createDeploymentCenter(region, name)
			.then(function(result) {
				logger.info('Deployment Center Created');
				logger.info('Please use the following information for your deployment manifests');
				logger.info({
					DeploymentCenter: {
						name: name,
						region: region
					}
				});
			})
			.catch(function(err) {
				logger.error(err);
			});
		});
};

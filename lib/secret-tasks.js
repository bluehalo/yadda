'use strict';

/**
 * @module SecretTasks
 */

var Q = require('q');
var _ = require('lodash');
var logger = require('winston');
var Credstash = require('nodecredstash');

/**
 * Generate Credstash credential store
 * @param {object} options - user provided options for the credential store
 * @param {object} options.DeploymentCenter - user provided options for the deployment center
 * @param {string} options.DeploymentCenter.name - Deployment center name
 * @param {string} options.DeploymentCenter.region - Deployment center region
 * @param {object} options.DeploymentCenter.secret - Secret options
 * @param {string} options.DeploymentCenter.secret.kmsKeyAlias - KMS Master Key Alias to encrypt/decrypt data
 * @return {module.exports|Credstash}
 */
function getCredentialStore(options){
	var centerName = options.DeploymentCenter.name+'-Secrets';
	var region = options.DeploymentCenter.region;
	var store = new Credstash({
		table: centerName,
		awsOpts: { region: region },
		kmsKey: options.DeploymentCenter.secret.kmsKeyAlias,
	});
	store.__name = centerName;
	return store;
}

/**
 * Creates SecretCenter table in DynamoDB
 * @param {object} options - user provided options
 */
exports.createSecretCenter = function(options){
	return Q.when(options)
		.then(function(){
			logger.info('Creating DeploymentCenter Secret Center');
			var store = getCredentialStore(options);

			return store.createDdbTable()
				.then(function(){
					logger.info(store.__name+' was created successfully');
					return options;
				});
		});
};

/**
 * Retrieve secret from credential store
 * @param {object} options - user provided options
 * @param {object} options.DeploymentCenter.secret - Secret Center options
 * @param {function} options.DeploymentCenter.secret._prefixKey - Secret key prefixer
 * @param {object} options.secretParams - Secret parameters
 * @param {string} options.secretParams.secret - Secret to retrieve from store
 * @param {string} options.secretParams.version - (Optional) specify which version you want to retrieve. Will automatically handle padding of 0's
 * @param {object} options.secretParams.context - (Optional) KMS context
 * @return {Q.Promise}
 */
exports.getSecret = function(options){
	return Q.when(options)
		.then(function(){
			var secrets = options.DeploymentCenter.secret;
			var params = options.secretParams;
			var store = secrets.secretStore();

			return store.getSecret({
				name: secrets._prefixKey(params.secret),
				version: _.padStart(params.version, 19, '0'),
				context: params.context,
			})
				.then(function(secrets){
					logger.warn(JSON.stringify(secrets, null, 2));
					return secrets;
				})
		});
};

/**
 * Put secret into credential store
 * @param {object} options - user provided options
 * @param {object} options.DeploymentCenter.secret - Secret Center options
 * @param {function} options.DeploymentCenter.secret._prefixKey - Secret key prefixer
 * @param {object} options.secretParams - Secret parameters
 * @param {string} options.secretParams.secret - Secret to retrieve from store
 * @param {string} options.secretParams.value - Secret value to encrypt into store
 * @param {string} options.secretParams.version - (Optional) specify which version you want to retrieve. Will automatically handle padding of 0's
 * @param {object} options.secretParams.context - (Optional) KMS context
 * @return {Q.Promise}
 */
exports.putSecret = function(options){
	return Q.when(options)
		.then(function(){
			if(!options.secretParams.secret || !options.secretParams.value)
				throw new Error('You forgot to specify the value to set `'+options.secretParams.secret+'` to');
		})
		.then(function(){
			var secrets = options.DeploymentCenter.secret;
			var params = options.secretParams;
			var store = secrets.secretStore();

			var opts = {
				name: secrets._prefixKey(params.secret),
				secret: params.value,
				version: _.padStart(params.version, 19, '0'),
				context: params.context,
			};

			return store.putSecret(opts)
				.then(function(){
					logger.info('Secret `'+opts.name+'` successfully put in store');
				});
		});
};

/**
 * Delete secret from credential store
 * @param {object} options - user provided options
 * @param {object} options.DeploymentCenter.secret - Secret Center options
 * @param {function} options.DeploymentCenter.secret._prefixKey - Secret key prefixer
 * @param {object} options.secretParams - Secret parameters
 * @param {string} options.secretParams.secret - Secret to retrieve from store
 * @param {string} options.secretParams.version - (Optional) specify which version you want to retrieve. Will automatically handle padding of 0's
 * @return {Q.Promise}
 */
exports.deleteSecret = function(options){
	return Q.when(options)
		.then(function(){
			var secrets = options.DeploymentCenter.secret;
			var params = options.secretParams;
			var store = secrets.secretStore();

			var opts = {
				name: secrets._prefixKey(params.secret),
				version: _.padStart(params.version, 19, '0'),
			};

			return store.deleteSecret(opts)
				.then(function(){
					logger.info('Secret `'+opts.name+'` (ver: '+Number.parseInt(opts.version)+') successfully deleted');
				})
		});
};

/**
 * Delete secret from credential store
 * @param {object} options - user provided options
 * @return {Q.Promise}
 */
exports.listSecrets = function(options){
	return Q.when(options)
		.then(function(){
			var store = options.DeploymentCenter.secret.secretStore();

			return store.listSecrets()
				.then(function(list){
					if(list.length === 0)
						logger.warn('There are no secrets you can see.');

					for(var secret in list)
						logger.info(list[secret]);

					return list;
				})
		});
};

/**
 * Verify that the secret center is configured
 * @param {object} options - User provided options
 * @param {object} options.DeploymentCenter - Deployment center configuration
 * @throws Error
 * @return options
 */
exports.verify = function(options){
	return Q.when(options)
		.then(function(){
			if(!('secret' in options.DeploymentCenter))
				throw new Error('Cannot manage secrets without Deployment Center `secret` configuration specified in environment');

			return options;
		})
};

/**
 * Sets up secret center parameters into options
 * @param {object} options - User provided options
 * @param {string} options.AppName - Application name and secret environment
 * @param {string} options.environment - Application environment
 * @param {string} options.aws.region - Application region
 * @param {object} options.DeploymentCenter.secret - Secret center configuration
 * @return options
 */
exports.setupSecretCenter = function(options){
	return Q.when(options)
		.then(function(){
			var app = options.AppName;
			var env = options.environment;
			var region = options.aws.region;

			options.DeploymentCenter.secret._prefixKey = function(name) { return [app, region, env, name].join('/') };
			options.DeploymentCenter.secret.secretStore = function(){ return getCredentialStore(options) };

			return options;
		});
};
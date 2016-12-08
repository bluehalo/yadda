'use strict';

var AWS = require('aws-sdk');
var Q = require('q');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');

var config = require('../config');
var logger = config.logger;

/**
 * Creates a Buffer of the Deployment Package for AWS Lambda of the Cron Lambda function.
 * @private
 * @param {string} deploymentCenterRegion - AWS Region for the Deployment Center
 * @param {string} deploymentCenterTableName - DynamoDB Table Name for the Deployment Center
 * @return {Promise.<Buffer>} Promise resolving to a buffer container the Zip file or rejecting with error.
 */
function packageLambdaZipfile() {
	var archiver = require('archiver');

	var deferred = Q.defer();
	var archive = archiver.create('zip', {});

	var lambdaFilesPath = path.resolve(path.join(__dirname,'../cron-lambda'));
	var streamToBuffer = require('stream-to-buffer');

	archive
	.file(path.join(lambdaFilesPath, 'index.js'), {name: 'index.js'})
	.directory(path.join(lambdaFilesPath, 'node_modules'), 'node_modules')
	.finalize();

	streamToBuffer(archive, deferred.makeNodeResolver());
	return deferred.promise;

}

module.exports.createDeploymentCenter = function(region, deploymentCenterName) {
	var cloudFormation = new AWS.CloudFormation({
		region: region
	});

	return Q.ninvoke(fs, 'readFile', path.resolve(path.join(__dirname,'../deployment-center/cloudformation.json')), 'utf8')
	.then(function(cloudformationTemplate) {
		logger.info('Creating Deployment Center');
		return Q.ninvoke(cloudFormation, 'createStack', {
			StackName: deploymentCenterName,
			TemplateBody: cloudformationTemplate,
			Capabilities: ['CAPABILITY_IAM']
		});
	})
	.then(function() {
		logger.info('Waiting for Deployment Center to be created...');
		return Q.ninvoke(cloudFormation, 'waitFor', 'stackCreateComplete', {
			StackName: deploymentCenterName
		});
	})
	.then(function(cloudFormationResults) {
		logger.info('Deployment Center Created');
		var outputs = _.get(cloudFormationResults, ['Stacks', 0, 'Outputs']);
		var lambdaFunction = _.find(outputs, {OutputKey: 'CronJobCheckerFunctionName'}).OutputValue;
		var deploymentTable = _.find(outputs, {OutputKey: 'DeploymentHistoryTableName'}).OutputValue;

		var lambda = new AWS.Lambda({
			apiVersion: '2015-03-31',
			region: region
		});

		logger.info('Packaging Cron Job Code');
		return packageLambdaZipfile()
		.then(function(zipfileBuffer){
			logger.info('Updating Cron Job Lambda');
			return Q.ninvoke(lambda, 'updateFunctionCode', {
				FunctionName: lambdaFunction,
				Publish: true,
				ZipFile: zipfileBuffer
			});
		});
	});
};

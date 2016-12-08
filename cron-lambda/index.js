'use strict';

var AWS = require('aws-sdk');
var later = require('later');

var dynamoDB = new AWS.DynamoDB.DocumentClient({
	region: process.env.DeploymentHistoryTableRegion
});

/**
 * Deployment Job Information
 * @typedef {Object} DeploymentJobInformation
 * @property {string} taskDefinitionArn - Task Definition ARN to run
 * @property {string} schedule - Cron Expression for when to run job.
 * @property {string} ecsCluster - Cluster Short Name for ECS Cluster to run job on.
 * @property {string} ecsRegion - Region for ECS Cluster
 */

/**
 * Executes the provided function on on each active Deployment Job in the deployment history table.
 * Executes asynchronously
 * @param {Function} fn - function to execute that takes in one deployment job
 * @param  {string} LastEvaluatedKey - Parameter used internally for recursive calls to address pagination of results.
 */
var foreachScheduledJob = function(fn, LastEvaluatedKey) {

	// Look for all deployed items with schedules (Active Deployed Jobs)
	var scanParameters = {
		TableName: process.env.DeploymentHistoryTableName,
		ConsistentRead: true,
		IndexName: 'DeploymentStatus',
		ProjectionExpression: 'tasks',
		FilterExpression: 'active = :active',
		ExpressionAttributeValues: {
			':active': 1
		}
	};

	if(LastEvaluatedKey) {
		scanParameters.ExclusiveStartKey = LastEvaluatedKey;
	}

	dynamoDB.scan(scanParameters, function(err, results) {
		if (err) {
			return console.error(err);
		}

		results.Items.forEach(function(item) {
			item.tasks.forEach(function(task) {
				// Call function for every scheduled task
				if (task.schedule) {
					fn(task);
				}
			});
		});

		// Call recursively for paginated results
		if(results.LastEvaluatedKey) {
			return foreachScheduledJob(fn, results.LastEvaluatedKey);
		}
	});
};

/**
 * Schedules the a task using the provided job info to run immediately on ECS.
 * @param {DeploymentJobInformation} jobInfo - job to run
 */
var runJob = function(jobInfo) {
	var ecs = new AWS.ECS({
		apiVersion: '2014-11-13',
		region: jobInfo.ecsRegion
	});

	var params = {
		cluster: jobInfo.ecsCluster,
		taskDefinition: jobInfo.taskDefinitionArn
	};

	console.log('Running', params.taskDefinition,'on', params.cluster);

	ecs.runTask(params, function(err, data) {
		if (err) {
			return console.error('Error running', params.taskDefinition, err);
		}
	});
};

/**
 * Lambda Handler
 * @param {object} event - CloudwatchEvent information
 * @param {object} context - AWS lambda context
 */
exports.runCronJobs = function (event, context) {
	// Use starting of minute for lambda as execution time
	var time = later.minute.start(new Date(event.time));
	console.log('Current Time', time);

	/**
	 * Check if the provided job should run at the above execution time.
	 * @param {DeploymentJobInformation} job - job to check
	 * @return {Boolean} If job should run at above execution time.
	 */
	var isScheduled = function(job) {
		var schedule = later.parse.cron(job.schedule);
		return later.schedule(schedule).isValid(time);
	};

	foreachScheduledJob(function(job) {
		if (isScheduled(job)) {
			runJob(job);
		}
	});
};

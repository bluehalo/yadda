'use strict';

var Q = require('q');
var docker = require('./docker-tools');
var AwsTools = require('./aws-tools');
var DeploymentCenter = require('./deployment-center.js');
var deploymentCenter = new DeploymentCenter();
var logger = require('winston');
var _ = require('lodash');

/**
 * Functions for executing Deployment Steps
 * @module DeploymentTasks
 */

/**
 * Creates a Pull Image Task to download the Docker Image currently in use by the provided service
 * @param  {module:AWSTools~ContainerService} containerService - container service to check for currently deployed services.
 * @param  {module:AWSTools~Registry} registry - Remove ECR Registery to pull from
 * @return {module:DeploymentTasks~PullTask} Pull task
 */
function pullImages(containerService, registry) {
	/**
	 * Task for pulling the currently in use image from ECR for the provided service.
	 * @function module:DeploymentTasks~PullTask
	 * @param  {DeploymentOptions} options - user provided options for this pull
	 * @return {string} Full docker image name in the formate repo_url/repo:tag that was pulled.
	 */
	return function(options) {
		logger.info('Pulling Deployed Images');
		var pullImagesJob = _.reduce(_.get(options, ['currentDeployment', 'tasks']), function(priorPullJob, task) {
			return priorPullJob.then(function(result) {
				logger.info('Looking up existing task', task.taskId);
				return Q.ninvoke(containerService, 'describeTaskDefinition', task.taskDefinitionArn)
				.then(function(taskDefinition) {
					var containers = _.get(taskDefinition, ['taskDefinition', 'containerDefinitions']);
					var taskType = task.taskType === 'service' ? 'services' : 'jobs';
					var targetContainerName = _.get(options, ['currentDeployment', 'deploymentInformation', taskType, task.taskId, 'taskTemplate', 'name']);
					var imageToPull = _.chain(containers)
						.filter({ name: targetContainerName })
						.map('image')
						.first()
						.value();

					logger.info('\tPulling', imageToPull);
					return Q.ninvoke(registry, 'getAuthorizationToken').then(function(authInformation) {
						logger.info('\tECR Authorized');
						logger.info('\tPulling image now... this can take a while');
						return Q.ninvoke(docker, 'pullImage', authInformation, imageToPull)
						.then(function() {
							logger.info('\tDone pulling', imageToPull);
							return imageToPull;
						});
					});
				});
			});
		}, Q.when({}));
		return pullImagesJob;
	};
}

function promiseMap(dictionary, fn) {
	var results = {};
	return _.reduce(dictionary, function(doPriorItem, value, key) {
		return doPriorItem.then(function() {
			return fn(value,key);
		})
		.then(function(result) {
			results[key] = result;
		});
	}, Q.when({}))
	.thenResolve(results);
}

/**
 * Creates a Build Images Task to create local Docker images that can be pushed
 * to the AWS
 * @private
 * @param {module:AWSTools~Registry} registry - Remote registry that will be target for this build.
 * @return {buildImages~BuildTask} - Build Task
 */
function buildImages(registry) {
	/**
	 * Task for building local docker images ready to be pushed to a remote AWS ECR repo
	 * @param {DeploymentOptions} buildOptions - user provided options for this build
	 * @return {object<string,string>} - Dictionary with key equal to image identifier from Manifest and value equal to t (in the format ecr_url/repo:tag).
	 */
	return function(buildOptions) {
		logger.info('Building Docker Images');
		logger.info('Will build the following images:');
		_.each(buildOptions.images, function(imageInfo,imageId) {
			logger.info('\t', imageId);
		});

		return promiseMap(buildOptions.images, function(imageInfo, imageId) {
				logger.info('Building', imageId);
				var repoName = [buildOptions.AppName, imageInfo.repo].join('/').toLowerCase();
				return Q.ninvoke(registry, 'findOrCreateECRRepository', repoName)
				.then(function(remoteRepo) {
					logger.info('\tUsing ECR Repo:', remoteRepo);
					var t = [remoteRepo, buildOptions.tag].join(':');
					var Dockerfile = imageInfo.dockerfile || 'Dockerfile';
					return Q.ninvoke(docker, 'build', imageInfo.dockerBuildContext, t, Dockerfile)
					.then(function() {
						logger.info('\tSuccessfully built:', t);
						return t;
					});
				});
		})
		.then(function(ts) {
			_.each(ts, function(t, imageId) {
				_.set(buildOptions, ['images', imageId, 't'], t);
			});
			return buildOptions;
		});
	};
}

/**
 * Creates a Push Image Task to push local Docker images to Remote ECR service
 * @private
 * @param {module:AWSTools~Registry} registry - configured aws tools object
 * @return {pushImagesToECR~pushTask} - Push Task
 */
var pushImagesToECR = function(registry) {
	/**
	 * Task for pushing local docker images to AWS ECR repo
	 * @param {object} deploymentInformation - deploymentInformation
	 * @return {object<string,string>} - same as ts
	 */
	return function(deploymentInformation) {
		logger.info('Pushing images to ECR');
		return Q.ninvoke(registry, 'getAuthorizationToken').then(function(authInformation) {
			logger.info('ECR Authorized');

			return promiseMap(deploymentInformation.images, function(imageInfo, imageId) {
				if (imageInfo.t) {
					logger.info('\tpushing', imageId,'to',imageInfo.t);
					return Q.ninvoke(docker, 'pushImage', authInformation, imageInfo.t)
					.then(function() {
						logger.info('\tSuccessfully pushed', imageInfo.t, 'to ECR');
					});
				}
			})
			.thenResolve(deploymentInformation);
		});
	};
};

function createTaskDefinition(taskInfo, taskId, options) {
	var taskDefinition = _.cloneDeep(taskInfo.taskTemplate);
	taskDefinition.image = _.get(options,['images', taskDefinition.image, 't'], taskDefinition.image);
	taskDefinition.family = _.join([options.AppName, taskId, options.environment], '-');
	return taskDefinition;
}

function registerTaskDefinition(taskName, taskDefinition, containerService) {
	logger.info('\tUpdating Task Definition for', taskName);
	return Q.ninvoke(containerService,'registerTaskDefinition', taskDefinition)
	.then(function(task) {
		var taskDefinitionRevision = task.family + ':' + task.revision;
		logger.info('\tSuccessfully updated task definition for', taskName,'to', taskDefinitionRevision);
		return task.taskDefinitionArn;
	})
	.catch(function(err) {
		var taskDefinitionError = new Error('Error registering task definition for ' + taskName + '. Check manifest files for missing parameters. (' + err.message + ')');
		return Q.reject(taskDefinitionError);
	});
}

/**
 * Creates an Update Task Definition Task to update the ECS Task Definition
 * using the provided template.
 * @private
 * @param {module:AWSTools~ContainerService} containerService - configured aws tools object
 * @return {updateTaskDefinitions~updateTask} - Update Task
 */
var updateTaskDefinitions = function(containerService) {
	/**
	 * Task for updating ECS task definition
	 * @param {DeploymentOptions} deploymentOptions - object representing data from Manifest files.
	 * @return {object} - Task Definition created on ECS.
	 */
	return function(deploymentOptions) {
		logger.info('Updating Task Definitions');

		var shouldUpdate = function(taskId) {
			return _.isNil(deploymentOptions.updateOnly) || _.includes(deploymentOptions.updateOnly, taskId);
		};

		var createTaskDefinitions = function(tasks) {
			return promiseMap(tasks, function(taskInfo, taskId) {

				if (shouldUpdate(taskId)) {
					if(! _.has(taskInfo,'taskTemplate')) {
						return Q.reject(new Error(taskId + ' is missing a task template.'));
					}
					var taskDefinition = createTaskDefinition(taskInfo, taskId, deploymentOptions);
					return registerTaskDefinition(taskId, taskDefinition,containerService);
				} else {
					return _.chain(deploymentOptions)
						.get(['currentDeployment', 'tasks'])
						.filter({ taskId: taskId })
						.map('taskDefinitionArn')
						.head()
						.value();
				}

			})
			.then(function(taskDefinitionArns) {
				_.each(taskDefinitionArns, function(taskDefinitionArn, taskId) {
					tasks[taskId].taskDefinitionArn = taskDefinitionArn;
				});
			});
		};

		return Q.when({})
		.then(function() {
			return createTaskDefinitions(deploymentOptions.services);
		})
		.then(function() {
			return createTaskDefinitions(deploymentOptions.jobs);
		})
		.thenResolve(deploymentOptions);
	};
};

/**
 * Creates an Update Service Task to update the service in ECS. A new service is created if it does not already exists.
 * @private
 * @param {module:AWSTools~ContainerService} containerService - configured aws tools object
 * @return {updateServices~updateServices} Update Service Task
 */
var updateServices = function(containerService) {
	/**
	 * Task for updating ECS Service
	 * @param {object} deploymentInformation - Information regarding the deployment
	 */
	return function(deploymentInformation) {
		logger.info('Updating Services');

		return promiseMap(deploymentInformation.serviceTasks, function(serviceTask) {
			logger.info('\tUpdating', serviceTask.taskId);
			logger.info('\tLooking for existing service named', serviceTask.taskId);
			return Q.ninvoke(containerService, 'describeService', serviceTask)
			.then(function(serviceInfo) {
				if (serviceInfo && serviceInfo.status === 'ACTIVE') {
					logger.info('Updating Service to use task definition', serviceTask.taskDefinitionArn);
					return Q.ninvoke(containerService, 'updateService', serviceTask);
				}
				else {
					// Service has never been created
					logger.info('\tService',serviceTask.taskId,'not found');
					logger.info('\tCreating new service with task definition', serviceTask.taskDefinitionArn);
					var serviceTemplate = _.get(deploymentInformation, ['services', serviceTask.taskId]);
					return Q.ninvoke(containerService, 'createService', serviceTask, serviceTemplate);
				}
			})
			.then(function() {
				logger.info('Successfully set service', serviceTask.taskId, 'to use', serviceTask.taskDefinitionArn);
			})
			.catch(function(err) {
				var serviceError = new Error('Error updating service'+ serviceTask.taskId +'. Check manifest file for missing parameters. (' + err.message + ')');
				return Q.reject(serviceError);
			});
		})
		.then(function() {
			// Check for services that should no longer be active.
			var servicesRemovedInThisDeployment = _.chain(deploymentInformation.currentDeployment)
				.get('tasks')
				.filter({taskType: 'service'})
				.filter(function(task) {
					return !_.find(deploymentInformation.serviceTasks, { 'taskId': task.taskId });
				})
				.value();

			return promiseMap(servicesRemovedInThisDeployment, function(serviceTaskToRemove) {
				logger.info('\tRemoving Existing Service', serviceTaskToRemove.taskId);
				return Q.ninvoke(containerService, 'deleteService', serviceTaskToRemove);
			});
		})
		.thenResolve(deploymentInformation);
	};
};

var finalizeDeployment = function() {
	return function(deploymentInformation) {

		logger.info('Finalizing deployment with Deployment Center');

		var deployment = {
			appName: deploymentInformation.AppName,
			environment: deploymentInformation.environment
		};

		deployment.tasks = _.concat(deploymentInformation.serviceTasks, deploymentInformation.jobTasks);

		deployment.deploymentInformation = deploymentInformation;

		if (deploymentInformation.currentDeployment) {
			deployment.parentDeployment = {
				appName: deploymentInformation.currentDeployment.appName,
				deploymentTimestamp: deploymentInformation.currentDeployment.deploymentTimestamp
			};
		}
		return deploymentCenter.finalizeDeployment(deployment)
		.then(function(data) {
			logger.info('Deployment Finalized');
			return data;
		});
	};
};

var finalizeRollback = function() {
	return function(deploymentInformation) {
		logger.info('Finishing Rollback');
		return Q.when({})
		.then(function() {
			return deploymentCenter.setActiveStatusForDeployment(deploymentInformation.currentDeployment, false);
		})
		.then(function() {
			if (deploymentInformation.parentDeployment) {
				return deploymentCenter.setActiveStatusForDeployment(deploymentInformation.parentDeployment, true);
			}
		})
		.thenResolve(deploymentInformation.parentDeployment);
	};
};

var setupDeploymentCenter = function() {
	return function(options) {
		var deploymentCenterRegion = _.get(options, ['DeploymentCenter', 'region']);
		var deploymentCenterTableName = _.get(options, ['DeploymentCenter', 'name']);
		return deploymentCenter.setup(deploymentCenterRegion, deploymentCenterTableName)
		.thenResolve(options);
	};
};

var getCurrentDeployment = function() {
	return function(options) {
		return deploymentCenter.getCurrentDeployedVersion(options.AppName, options.environment)
		.then(function(currentDeployedVersion) {
			_.unset(currentDeployedVersion, 'deploymentInformation.currentDeployment');
			options.currentDeployment = currentDeployedVersion;
			return options;
		});
	};
};

var extractSettingsFromParentDeployment = function() {
	return function(options) {

		return deploymentCenter.get(options.currentDeployment.parentDeployment)
		.then(function(parentDeployment) {
			options.parentDeployment = parentDeployment;
			var parentTasks = _.get(parentDeployment, 'tasks');
			options.serviceTasks = _.filter(parentTasks, { taskType: 'service' });
			options.jobTasks = _.filter(parentTasks, { taskType: 'job' });
			options.services = _.get(parentDeployment, ['deploymentInformation', 'services'], {});
			return options;
		});
	};
};

var runJob = function(containerService, jobName) {
	return function(results) {
		var task = _.chain(results)
			.get(['currentDeployment', 'tasks'])
			.filter({'taskId': jobName, 'taskType': 'job'})
			.head()
			.value();

		if (task) {
			return Q.ninvoke(containerService, 'runTask', task);
		}
		return Q.reject('No Job Found');
	};
};

var runOnDeployJobs = function(containerService) {
	return function(results) {
		logger.info('Running jobs with runOnDeploy=before');
		return Q.allSettled(_.map(
			_.chain(results)
			.get('tasks')
			.filter({'taskType': 'job', 'runOnDeploy': 'before'})
			.value(),
			function(task) {
				logger.info('Running job: ' + task.taskId);
				return Q.ninvoke(containerService, 'runTask', task);
			})
		)
		.then(function() {
			logger.info('Waiting for services to be stable');
			var clusterInfo = _.groupBy(_.chain(results)
					.get('tasks')
					.filter({'taskType': 'service'})
					.value(),
				'ecsCluster');
			return Q.allSettled(_.flatMap(clusterInfo, function(value, key) {
				return _.map(_.chunk(value, 10), function(chunk) {
					var servicesToWaitFor = _.chain(chunk)
						.map('serviceName')
						.value();
					return Q.ninvoke(containerService, 'waitForServicesStable', {services: servicesToWaitFor, cluster: key});
				});
			}));
		})
		.then(function() {
			logger.info('Running jobs with runOnDeploy=after');
			return Q.allSettled(_.map(
				_.chain(results)
				.get('tasks')
				.filter({'taskType': 'job', 'runOnDeploy': 'after'})
				.value(),
				function(task) {
					logger.info('Running job: ' + task.taskId);
					return Q.ninvoke(containerService, 'runTask', task);
				})
			);
		})
		.thenResolve(results);
	};
};

var deregisterTaskDefinition = function(containerService) {
	return function(taskInfo) {
		if (taskInfo) {
			return Q.ninvoke(containerService, 'deregisterTaskDefinition', taskInfo.taskDefinitionArn);
		}
	};
};

var buildDeployableTaskItems = function() {
	return function (options) {
		options.serviceTasks = _.chain(options.services)
		.pickBy(function(serviceInfo, serviceId) {
			return serviceInfo.taskDefinitionArn;
		})
		.map(function(serviceInfo, serviceId) {
			return {
				taskId: serviceId,
				serviceName: _.join([options.AppName,serviceId, options.environment], '-'),
				ecsCluster: serviceInfo.cluster,
				ecsRegion: options.aws.region,
				taskType: 'service',
				taskDefinitionArn: serviceInfo.taskDefinitionArn
			};
		})
		.value();

		options.jobTasks = _.chain(options.jobs)
		.pickBy(function(jobInfo, jobId) {
			return jobInfo.taskDefinitionArn;
		})
		.map(function(jobInfo, jobId) {
			var task = {
				taskId: jobId,
				ecsCluster: jobInfo.cluster,
				ecsRegion: options.aws.region,
				taskType: 'job',
				taskDefinitionArn: jobInfo.taskDefinitionArn
			};

			if (jobInfo.schedule) {
				task.schedule = jobInfo.schedule;
			}
			if (jobInfo.runOnDeploy) {
				task.runOnDeploy = jobInfo.runOnDeploy;
			}

			return task;
		})
		.value();

		return options;
	};
};

var pruneTasks = function() {
		return function(options) {

			var isActivePredicate = function(taskInfo, taskId) {
				return _.get(taskInfo, 'active', true);
			};

			options.services = _.pickBy(options.services, isActivePredicate);
			options.jobs = _.pickBy(options.jobs, isActivePredicate);

			return options;
		};
};

/**
 * Task for building and pushing a new image to ECR and creating an updated Task
 * Definition using the new image. By default, the associated Service will also
 * be updated to use the new Task Definition, but this can be disabled with options
 * @param {DeploymentOptions} options - user provided options for this deployment
 * @return {Promise.<DeploymentResult>} promise resolving to a DeploymentResult for this deployment
 */
exports.deploy = function(options) {
	var registery = new AwsTools.Registry(options.aws.region);
	var containerService = new AwsTools.ContainerService(options.aws.region);
	return Q.when(options)
	.then(setupDeploymentCenter())
	.then(getCurrentDeployment())
	.then(pruneTasks())
	.then(buildImages(registery))
	.then(pushImagesToECR(registery))
	.then(updateTaskDefinitions(containerService))
	.then(buildDeployableTaskItems())
	.then(updateServices(containerService))
	.then(finalizeDeployment())
	.then(runOnDeployJobs(containerService))
	.then(function(result) {
		return {
			result: result,
			options: options
		};
	});
};

/**
 * Task for rolling back to a prior deployment
 * @param {object} options - user provided options for this deployment
 * @param {string} options.deployedItemId - the service or job name to rollback
 * @param {string} options.taskDefinitionArn - arn or task definition revision (in format 'family:revision') to rollback to.
 * @return {Promise.<DeploymentResult>} promise resolving to a DeploymentResult for this rollback
 */
exports.rollback = function(options) {
	var containerService = new AwsTools.ContainerService(options.aws.region);
	logger.info('Rolling Back');
	return Q.when(options)
	.then(setupDeploymentCenter())
	.then(getCurrentDeployment())
	.then(function(options) {
		if (options.currentDeployment) {
			return options;
		} else {
			return Q.reject('No existing deployment in this environment to rollback from.');
		}
	})
	.then(extractSettingsFromParentDeployment())
	.then(updateServices(containerService))
	.then(finalizeRollback())
	.then(function(result) {
		return {
			result: result,
			options: options
		};
	});
};

/**
 * Task for building a local docker image ready to be pushed to a remote AWS ECR repo
 * @param {DeploymentOptions} options - user provided options for this build
 * @return {string} t for this build in the format ecr_url/repo:tag
 */
exports.build = function(options) {
	var registery = new AwsTools.Registry(options.aws.region);
	return Q.when(options)
		.then(buildImages(registery));
};

/**
 * Task for building a local docker image ready to be pushed to a remote AWS ECR repo
 * @param {DeploymentOptions} options - user provided options for this build
 * @return {string} t for this build in the format ecr_url/repo:tag
 */
exports.buildPush = function(options) {
	var registery = new AwsTools.Registry(options.aws.region);
	return Q.when(options)
		.then(buildImages(registery))
		.then(pushImagesToECR(registery));
};

/**
 * Task for pulling the docker image from ECR corresponding to currently deployed service.
 * @param  {DeploymentOptions} options - user provided options for this pull
 * @return {string} Full docker image name in the formate repo_url/repo:tag that was pulled.
 */
exports.pull = function(options) {
	var containerService = new AwsTools.ContainerService(options.aws.region);
	var registery = new AwsTools.Registry(options.aws.region);
	return Q.when(options)
		.then(setupDeploymentCenter())
		.then(getCurrentDeployment())
		.then(pullImages(containerService, registery));
};

/**
 * Returns all services from the Manifest
 * @param  {DeploymentOptions} options - user provided options
 * @return {Array.<string>} Array of service names.
 */
exports.listServices = function(options) {
	return _.keys(options.services);
};

/**
 * Returns all jobs from the Manifest
 * @param  {DeploymentOptions} options - user provided options
 * @return {Array.<string>} Array of job names.
 */
exports.listJobs = function(options) {
	return _.keys(options.jobs);
};

/**
 * Runs the provided job immediately
 * @param  {DeploymentOptions} options - user provided options
 * @param {string} options.job - Job name for job to run immediately
 */
exports.runJob = function(options) {
	var registry = new AwsTools.Registry(options.aws.region);
	var containerService = new AwsTools.ContainerService(options.aws.region);
	options = _.omit(options, 'services');
	options.jobs = _.pick(options.jobs, options.job);
	options.images = _.pick(options.images, _.get(options, ['jobs', options.job, 'taskTemplate', 'image']));
	return Q.when(options)
		.then(setupDeploymentCenter())
		.then(getCurrentDeployment())
		.then(runJob(containerService, options.job));
};

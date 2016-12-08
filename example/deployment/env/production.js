'use strict';

module.exports = {

	// What ECS Cluster (and its region) should be used for this environment
	aws: {
		region: 'us-east-1',
		defaultECSCluster: 'MY_PRODUCTION_ECS_CLUSTER_NAME'
	},

	// Environment Files let you override information in the manifest, or add new
	//  information, necessary for deployment to a specific environment

	services: {

		'hello-world-server': {

			taskTemplate: {

				// Using Key-Value Environment variables allows you to specify
				// deployment environment specific values
				environment: {
					DEPLOYMENT_ENVIRONMENT_NAME: 'Production'
				}
			}
		}
	},

	jobs: {

		'docker-hello-world-job': {

			taskTemplate: {

				/*
				// Environment variables can be changed for jobs too

				environment: {
					DEPLOYMENT_ENVIRONMENT_NAME: 'Production Job'
				},
				*/
			}
		}
	}
};

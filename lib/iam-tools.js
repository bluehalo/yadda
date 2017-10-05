var aws = require('aws-sdk');
var IAM = aws.IAM;
var DYNAMO = aws.DynamoDB;
var Q = require('q');
var _ = require('lodash');

var assumeRolePolicy = {
	Version : "2012-10-17",
	Statement: [
		{
			Effect: "Allow",
			Principal: {
				Service: ["ec2.amazonaws.com"]
			},
			Action: ["sts:AssumeRole"]
		}
	]
};

var emptyPolicy = {
	PolicyName: "",
	PolicyDocument: {
		Version : "2012-10-17",
		Statement: []
	}
};

/**
 *
 * @param {string} region - AWS Region
 * @param {object|} iamOptions [undefined] - IAM Options
 * @param {object} dynamoOptions [undefined] - DynamoDB Options
 * @return {*}
 */
module.exports = function(region, iamOptions, dynamoOptions){
	var Ioptions = iamOptions || { apiVersion: '2010-05-08', region: region };
	var Doptions = dynamoOptions || { apiVersion: '2012-08-10', region: region };

	var iam = new IAM(Ioptions);
	var dynamo = new DYNAMO(Doptions);

	return _exported = {
		iam: {
			/**
			 * Create policy http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/IAM.html#createRole-property
			 * @param {object} policy
			 * @param {string} policy.AssumeRolePolicyDocument
			 * @param {string} policy.Path
			 * @param {string} policy.RoleName
			 * @return {Promise}
			 */
			createRolefromPolicy: function(policy){
				return Q.Promise(function(resolve, reject){
					iam.createRole(policy, function(err, data){
						if(err) return reject(err);

						return resolve(data);
					});
				});
			},

			/**
			 * Create policy http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/IAM.html#createPolicy-property
			 * @param {object} policy
			 * @param {string} policy.PolicyDocument
			 * @param {string} policy.PolicyName
			 * @param {string} policy.Description
			 * @param {string} policy.Path
			 * @return {Promise}
			 */
			createPolicy: function(policy){
				return Q.Promise(function(resolve, reject){
					iam.createPolicy(policy, function(err, data){
						if(err) return reject(err);

						return resolve(data);
					});
				});
			},

			/**
			 * Attach policy to role http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/IAM.html#attachRolePolicy-property
			 * @param {string} policy - Policy ARN
			 * @param {string} role - Role name
			 * @return {Promise}
			 */
			attachPolicyToRole: function(policy, role){
				return Q.Promise(function(resolve, reject){
					iam.attachRolePolicy({
						RoleName: role,
						PolicyArn: policy
					}, function(err, data){
						if(err) return reject(err);

						return resolve(data);
					});
				});
			},

			/**
			 * Transform policy to valid AWS format
			 * @param {object} rolePolicy - Policy Document
			 * @param {object} rolePolicy.PolicyDocument - Policy document to transform
			 */
			transformPolicy: function(rolePolicy){
				return Q.when(policy)
					.then(function(){
						var policy = _.cloneDeep(rolePolicy);
						policy.PolicyDocument = JSON.stringify(policy.PolicyDocument);
						return policy;
					})
			}
		},
		dynamoDB: {
			/**
			 * Get ARN from table name
			 * @param {string} tableName - Dynamo TableName
			 * @return {Promise<string>}
			 */
			getTableArn: function(tableName){
				return Q.Promise(function(resolve, reject){
					dynamo.describeTable({ TableName: tableName }, function(err, data){
						if(err) return reject(err);

						return resolve(data.Table.TableArn);
					});
				})
			},

			/**
			 * Create Read only dynamodb table role
			 * @param {string} tableName
			 * @return {promise|*}
			 */
			createReadOnlyRole: function(tableName){
				return Q.when({})
					.then(function() {

						return _exported.dynamoDB.getTableArn(tableName)
							.then(function (tableArn) {
								var RoleName = tableName + '-readonly';

								return Q.when(tableArn)
									.then(function () {
										return _exported.iam.createRolefromPolicy({
											RoleName: RoleName,
											AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicy),
											Path: "/",
											Description: "Read only access to the `" + tableName + "` table",
										});
									})
									.then(function (role) {
										var rolePolicy = _.cloneDeep(emptyPolicy);
										rolePolicy.PolicyName = RoleName + "-policy";

										rolePolicy.PolicyDocument.Statement.push({
											Effect: "Allow",
											Action: [
												"dynamodb:BatchGetItem",
												"dynamodb:DescribeTable",
												"dynamodb:GetItem",
												"dynamodb:ListTables",
												"dynamodb:Query",
												"dynamodb:Scan",
											],
											Resource: [tableArn]
										});

										return Q.when({})
											.then(_exported.iam.transformPolicy(rolePolicy))
											.then(_exported.iam.createPolicy)
											.then(function(policy){ return [policy, role] });
									})
									.then(function(policyAndRole){
										return _exported.iam.attachPolicyToRole(
											policyAndRole[0].Policy.Arn,
											policyAndRole[1].Role.RoleName
										)
											.then(function(){
												return policyAndRole[1].Role;
											});
									})
							});
					});
			},

			/**
			 * Create Administration role for dynamo DB
			 * @param {string} tableName
			 * @return {promise|*}
			 */
			createAdminRole: function(tableName){
				return Q.when({})
					.then(function(){;
						return _exported.dynamoDB.getTableArn(tableName)
							.then(function (tableArn) {
								var RoleName = tableName+'-administration';

								return Q.when(tableArn)
									.then(function () {
										return _exported.iam.createRolefromPolicy({
											RoleName: RoleName,
											AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicy),
											Path: "/",
											Description: "Administration access to `" + tableName + "` table",
										});
									})
									.then(function (role) {
										var rolePolicy = _.cloneDeep(emptyPolicy);
										rolePolicy.PolicyName = RoleName + "-policy";

										rolePolicy.PolicyDocument.Statement.push({
											Effect: "Allow",
											Action: [
												"dynamodb:*"
											],
											Resource: [tableArn]
										});

										return Q.when({})
											.then(_exported.iam.transformPolicy(rolePolicy))
											.then(_exported.iam.createPolicy)
											.then(function(policy){ return [policy, role] });
									})
									.then(function(policyAndRole){
										return _exported.iam.attachPolicyToRole(
											policyAndRole[0].Policy.Arn,
											policyAndRole[1].Role.RoleName
										)
											.then(function(){
												return policyAndRole[1].Role;
											});
									})
							});
					});
			}
		}
	}
};


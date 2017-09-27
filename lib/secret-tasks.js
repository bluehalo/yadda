'use strict';

var Q = require('q');
var logger = require('winston');
var storage = require('nodecredstash');


exports.getSecret = function(options){
	return Q.when(options)
		.then(function(){
			console.log(options);
		});
};

exports.putSecret = function(options){
	return Q.when(options)
};

exports.createSecretCenter = function(options){

	return Q.when(options);
};

exports.verify = function(options){
	return Q.when(options)
		.then(function(){
			if(!('secret' in options.DeploymentCenter))
				throw new Error('Cannot manage secrets without Deployment Center `secret` configuration specified in environment');

			return options;
		})
};

exports.generateSecretKey = function(options){
	return Q.when(options)
		.then(function(){
			var env = options.environment;
			var region = options.DeploymentCenter.region;

			options.DeploymentCenter.secret._prefixKey = function(name) { return [region, env, name].join('/') };

			return options;
		});
};
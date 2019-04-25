/*
 * moleculer
 * Copyright (c) 2018 MoleculerJS (https://github.com/moleculerjs/moleculer)
 * MIT Licensed
 */

"use strict";

const _ = require("lodash");

let broker;

function tracingLocalActionMiddleware(handler, action) {
	let opts = action.tracing;
	if (opts === true || opts === false)
		opts = { enabled: !!opts };
	opts = _.defaultsDeep({}, opts, { enabled: true });

	if (opts.enabled) {
		return function tracingMiddleware(ctx) {

			if (!ctx.requestID)
				ctx.requestID = ctx.broker.tracer.getCurrentTraceID();

			if (!ctx.parentID)
				ctx.parentID = ctx.broker.tracer.getParentSpanID();

			const tags = {
				callingLevel: ctx.level,
				action: ctx.action ? {
					name: ctx.action.name,
					rawName: ctx.action.rawName
				} : null,
				remoteCall: ctx.nodeID !== ctx.broker.nodeID,
				callerNodeID: ctx.nodeID,
				nodeID: ctx.broker.nodeID,
				options: {
					timeout: ctx.options.timeout,
					retries: ctx.options.retries
				}
			};

			if (_.isFunction(opts.tags)) {
				const res = opts.tags.call(ctx.service, ctx);
				if (res)
					Object.assign(tags, res);
			} else if (Array.isArray(opts.tags)) {
				opts.tags.forEach(key => {
					if (key.startsWith("#"))
						tags[key.slice(1)] = _.get(ctx.meta, key.slice(1));
					else
						tags[key] = _.get(ctx.params, key);
				});
			}

			const span = ctx.broker.tracer.startSpan(`action '${ctx.action.name}'`, {
				id: ctx.id,
				traceID: ctx.requestID,
				parentID: ctx.parentID,
				service: ctx.service ? {
					name: ctx.service.name,
					version: ctx.service.version,
					fullName: ctx.service.fullName,
				} : null,
				sampled: ctx.tracing,
				tags
			}, ctx);

			ctx.tracing = span.sampled;
			ctx.span = span;

			return new Promise((resolve, reject) => {

				ctx.broker.tracer.wrappingContext(span, function() {

					// Call the handler
					return handler(ctx).then(res => {
						span.addTags({
							fromCache: ctx.cachedResult
						}).finish();

						//ctx.duration = span.duration;

						return resolve(res);
					}).catch(err => {
						span.setError(err).finish();

						return reject(err);
					});

				});
			});

		}.bind(this);
	}

	return handler;
}

function tracingLocalEventMiddleware(handler, event) {
	const service = event.service;
	let opts = event.tracing;
	if (opts === true || opts === false)
		opts = { enabled: !!opts };
	opts = _.defaultsDeep({}, opts, { enabled: true });

	if (opts.enabled) {
		return function tracingMiddleware() {
			const payload = arguments[0];
			const callerNodeID = arguments[1];
			const eventName = arguments[2];

			const tags = {
				event: {
					name: event.name,
					group: event.group
				},
				eventName,
				callerNodeID,
			};

			if (_.isFunction(opts.tags)) {
				const res = opts.tags.call(service, payload);
				if (res)
					Object.assign(tags, res);
			} else if (Array.isArray(opts.tags)) {
				opts.tags.forEach(key => tags[key] = _.get(payload, key));
			}

			const span = broker.tracer.startSpan(`event '${eventName}'`, {
				// id: ctx.id,
				// traceID: ctx.requestID,
				// parentID: ctx.parentID,
				service: {
					name: service.name,
					version: service.version,
					fullName: service.fullName,
				},
				tags
			});

			// Call the handler
			return handler.apply(service, arguments).then(() => {
				span.finish();
			}).catch(err => {
				span.setError(err).finish();
				return service.Promise.reject(err);
			});

		};
	}

	return handler;
}

/*
function wrapRemoteTracingMiddleware(handler) {

	if (this.options.tracing) {
		return function tracingMiddleware(ctx) {
			if (ctx.tracing == null) {
				ctx.tracing = shouldTracing(ctx);
			}
			return handler(ctx);

		}.bind(this);
	}

	return handler;
}*/

module.exports = function TracingMiddleware() {
	broker = this;
	const tracer = broker.tracer;

	return {
		localAction: broker.isTracingEnabled() && tracer.opts.actions ? tracingLocalActionMiddleware : null,
		localEvent: broker.isTracingEnabled() && tracer.opts.events ? tracingLocalEventMiddleware : null,
		//remoteAction: wrapRemoteTracingMiddleware
	};
};

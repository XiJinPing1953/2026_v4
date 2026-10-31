'use strict'
let acl
try { acl = require('../common/pageAcl') } catch (_) { acl = require('./pageAclLocal') }
const { createService } = require('./service')
const service = createService({ database: uniCloud.database(), acl, cloud: uniCloud })
exports.main = service.main

// Explicit diagnostic requests only; ordinary requests keep the original response.

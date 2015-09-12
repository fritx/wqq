var request = require('request')
var _ = require('lodash')
var fs = require('fs')
var Emitter = require('easy-emitter')
var encrypt = require('./lib/psw-encrypt')
var async = require('async')
var debug = require('debug')('wqq')

var appid = 501004106
var clientid = 53999199
var font = {
  'name': '宋体',
  'size': 10,
  'style': [0, 0, 0],
  'color':  '000000'
}

var QQ = module.exports = function QQ() {
  this.jar = request.jar()
  this.request = request.defaults({
    jar: this.jar,
    headers: {
      'Connection': 'keep-alive',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Ubuntu Chromium/39.0.2171.65 Chrome/39.0.2171.65 Safari/537.36'
    }
  })
  this.store = {}
  this.form = {}
  this.meta = {}
  this.groups = {}
  this.discus = {}
  this.friends = null
  this.toPoll = false
  // this.failCount = 0
  Emitter.call(this)
}

QQ.prototype._onPoll = function _onPoll(d) {
  debug('拉取消息包', d)
  if (!d) return // 未响应
  if (typeof d === 'string') return // 偶尔返回异常html
  if (d.retcode === 102) return // 无消息
  if (d.retcode === 116) {
    return this.jar.setCookie('ptwebqq=' + d.p, 'qq.com')
  }
  // if (_.contains([
  //   100, 120, 121,  // NotReLogin, ReLinkFailure
  //   103, 112, 113, 115
  // ], d.retcode) {
  //   return this._onDisconnect()
  // }
  if (d.retcode !== 0) {
    return this._onDisconnect()
  }
  if (!Array.isArray(d.result)) return
  d.result = d.result.sort(function (a, b) {
    return a.value.time - b.value.time
  })
  var _this = this
  async.eachSeries(d.result, function (d, next) {
    _.extend(d, d.value)
    delete d.value
    // debug('接收消息', d)
    if (d.msg_type === 48) { // kick_message
      return _this._onKick()
    }
    if (_.contains([
      'input_notify', // 121
      'buddies_status_change',
      'system_message'
    ], d.poll_type)) return next()
    if (!_.contains([
      45, // group_web_message
      43, // group_message
      42, // discu_message
      9 // message
    ], d.msg_type)) {
      debug('未知消息类型', d)
      return next()
    }
    // debug('接收消息', d)
    async.waterfall([
      function (next) {
        if (d.group_code) {
          _this.getGroupInfo(d.group_code, function(e, d1) {
            d.group_name = d1.ginfo.name
            var c = _.find(d1.minfo, { uin: d.send_uin })
            if (c) d.send_nick = c.nick
            c = _.find(d1.cards, { muin: d.send_uin })
            if (c) d.send_gnick = c.card
            next()
          })
        } else if (d.did) {
          _this.getDiscuInfo(d.did, function(e, d1) {
            d.discu_name = d1.info.discu_name
            var c = _.find(d1.mem_info, { uin: d.send_uin })
            if (c) d.send_nick = c.nick
            next()
          })
        } else next()
      },
      function (next) {
        _this.getFriendMeta(d.send_uin || d.from_uin, function (e, d1) {
          if (d1.account) d.send_account= d1.account
          if (d1.account === 80000000) d.anonymous = true
          if (d1.nick) d.send_nick = d1.nick
          if (d1.mark) d.send_mark = d1.mark
          next()
        })
      },
      function (next1) {
        var c = d.content
        if (!c) return next1()
        if (Array.isArray(c[0]) && c[0][0] === 'font') c = c.slice(1)
        c = c.map(function (chunk) {
          if (typeof chunk === 'string') return chunk
          if (chunk[0] === 'face') return chunk
          if (chunk[0] === 'cface') {
            chunk[1] = chunk[1].name.match(/\.(.*)$/)[1]
            return chunk
          }
        })
        c = _.compact(c)
        if (typeof c[0] === 'string' &&
          /[\u0000\u0002]宋体\r$/.test(c[0])) return
        d.content = c
        next1()
      },
      function (next) {
        if (d.msg_type === 45) {
          var d1 = d.xml.match(/<n t="t" s="(\d+:\d+):\d+"\/>/)
          if (!d1) return
          d.timestr = d1[1]
          d1 = d.xml.match(/<n t="t" s="([^=]*)"\/>/g)
          d.file = _.last(d1).match(/<n t="t" s="([^=]*)"\/>/)[1]
        }
        if (d.poll_type === 'file_message') d.file = d.name
        next()
      }
    ], function (e) {
      d = _.omit(d, [
        'msg_id', 'msg_id2', 'reply_ip', 'seq', 'info_seq',
        'xml', 'group_type', 'ver'
      ])
      if (d.msg_type === 9) d.is_private = true
      _this.emit('message', d)
      next()
    })
  })
}
QQ.prototype._onDisconnect = function _onDisconnect() {
  // fixme: 需要重新登录
  this.stopPoll()
  this.emit('disconnect')
}
QQ.prototype._onKick = function _onKick() {
  this.stopPoll()
  this.emit('kick')
}

QQ.prototype.stopPoll = function stopPoll() {
  this.toPoll = false
}
QQ.prototype.startPoll = function startPoll() {
  this.toPoll = true
  this._loopPoll()
}
QQ.prototype._loopPoll = function _loopPoll() {
  if (!this.toPoll) return
  var _this = this
  this._poll(function (e, d) {
    _this._onPoll(d)
    setTimeout(function(){
      _this._loopPoll()
    }, e ? 10000 : 0)
  })
}
QQ.prototype._poll = function _poll(cb) {
  this.request.post({
    url: 'http://d.web2.qq.com/channel/poll2',
    form: {
      r: JSON.stringify({
        ptwebqq: this._getPtwebqq(),
        psessionid: this.store.psessionid,
        key: '',
        clientid: clientid
      })
    },
    headers: {
      'Referer': 'http://d.web2.qq.com/proxy.html?v=20130916001&callback=1&id=2'
    },
    //timeout: 20000,
    //timeout: 55000, // by @junfan
    timeout: 65000, // 现在他们是60秒
    json: true
  }, function (e, r, d) {
    cb(e, d)
  })
}

QQ.prototype.sendDiscuMsg = function sendDiscuMsg(did, chunks, cb) {
  this.request.post({
    url: 'http://d.web2.qq.com/channel/send_discu_msg2',
    form: {
      r: JSON.stringify({
        did: did,
        content: JSON.stringify(chunks.concat([['font', font]])),
        clientid: clientid,
        msg_id: nextMsgId(),
        psessionid: this.store.psessionid
      })
    },
    headers: {
      'Referer': 'http://d.web2.qq.com/proxy.html?v=20130916001&callback=1&id=2'
    },
    json: true
  }, function (e, r, d) {
    cb(e, d.retcode === 0)
  })
}
QQ.prototype.sendGroupMsg = function sendGroupMsg(uin, chunks, cb) {
  this.request.post({
    url: 'http://d.web2.qq.com/channel/send_qun_msg2',
    form: {
      r: JSON.stringify({
        group_uin: uin,
        content: JSON.stringify(chunks.concat([['font', font]])),
        clientid: clientid,
        msg_id: nextMsgId(),
        psessionid: this.store.psessionid
      })
    },
    headers: {
      'Referer': 'http://d.web2.qq.com/proxy.html?v=20130916001&callback=1&id=2'
    },
    json: true
  }, function (e, r, d) {
    cb(e, d.retcode === 0)
  })
}
QQ.prototype.sendBuddyMsg = function sendBuddyMsg(uin, chunks, cb) {
  this.request.post({
    url: 'http://d.web2.qq.com/channel/send_buddy_msg2',
    form: {
      r: JSON.stringify({
        to: uin,
        content: JSON.stringify(chunks.concat([['font', font]])),
        clientid: clientid,
        msg_id: nextMsgId(),
        psessionid: this.store.psessionid
      })
    },
    headers: {
      'Referer': 'http://d.web2.qq.com/proxy.html?v=20130916001&callback=1&id=2'
    },
    json: true
  }, function (e, r, d) {
    cb(e, d.retcode === 0)
  })
}

QQ.prototype.getDiscuInfo = function getDiscuInfo(did, cb) {
  if (this.discus[did]) return cb(null, this.discus[did])
  var _this = this
  this.request({
    url: 'http://d.web2.qq.com/channel/get_discu_info',
    qs: {
      did: did,
      vfwebqq: this.store.vfwebqq,
      clientid: clientid,
      psessionid: this.store.psessionid,
      t: Date.now()
    },
    headers: {
      'Referer': 'http://d.web2.qq.com/proxy.html?v=20130916001&callback=1&id=2'
    },
    json: true
  }, function (e, r, d) {
    d = d.result
    d.mcount = d.mem_info.length
    d = _.pick(d, ['info', 'mem_info', 'mcount'])
    _this.discus[did] = d
    cb(e, d)
  })
}
QQ.prototype.getGroupInfo = function getGroupInfo(code, cb) {
  if (this.groups[code]) return cb(null, this.groups[code])
  var _this = this
  this.request({
    url: 'http://s.web2.qq.com/api/get_group_info_ext2',
    qs: {
      gcode: code,
      vfwebqq: this.store.vfwebqq,
      t: Date.now()
    },
    headers: {
      'Referer': 'http://s.web2.qq.com/proxy.html?v=20130916001&callback=1&id=1'
    },
    json: true
  }, function (e, r, d) {
    d = d.result
    d.mcount = d.minfo.length
    d = _.pick(d, ['cards', 'ginfo', 'minfo', 'mcount'])
    _this.groups[code] = d
    cb(e, d)
  })
}

QQ.prototype.getFriendMeta = function getFriendMeta(tuin, cb) {
  if (this.meta[tuin]) return cb(null, this.meta[tuin])
  var o = { uin: tuin }
  var d = _.find(this.friends.marknames, { uin: tuin })
  if (d) o.mark = d.markname
  d = _.find(this.meta.info, { uin: tuin })
  if (d) {
    o.nick = d.nick
    this.meta[tuin] = o
    return cb(e, o)
  }
  var _this = this
  this.getFriendInfo(tuin, function (e, d) {
    if (d.account) o.account = d.account
    o.nick = d.nick
    _this.meta[tuin] = o
    cb(e, o)
  })
}

QQ.prototype.getSelfInfo = function getSelfInfo(cb) {
  this.getFriendInfo(this.store.uin, function (e, d) {
    cb(e, d)
  })
}
QQ.prototype.getFriendInfo = function getFriendInfo(tuin, cb) {
  var _this = this
  var o = {}
  this._getFriendUin(tuin, function (e, d) {
    if (d && d.result) o.account = d.result.account
    _this._getFriendInfo(tuin, function (e, d) {
      _.extend(o, d && d.result)
      _this._getFriendLNick(tuin, function (e, d) {
        if (d && d.result) o.lnick = d.result.lnick
        cb(e, o)
      })
    })
  })
}

QQ.prototype._getFriendInfo = function _getFriendInfo(tuin, cb) {
  this.request({
    url: 'http://s.web2.qq.com/api/get_friend_info2',
    qs: {
      tuin: tuin,
      vfwebqq: this.store.vfwebqq,
      clientid: clientid,
      psessionid: this.store.psessionid,
      t: Date.now()
    },
    headers: {
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, sdch',
      'Accept-Language': 'zh-CN,zh;q=0.8,en;q=0.6',
      'Content-Type': 'utf-8',
      'Host': 's.web2.qq.com',
      'Referer': 'http://s.web2.qq.com/proxy.html?v=20130916001&callback=1&id=1'
    },
    json: true
  }, function (e, r, d) {
    cb(e, d)
  })
}
QQ.prototype._getFriendLNick = function _getFriendLNick(tuin, cb) {
  this.request({
    url: 'http://s.web2.qq.com/api/get_single_long_nick2',
    qs: {
      tuin: tuin,
      vfwebqq: this.store.vfwebqq,
      t: Date.now()
    },
    headers: {
      'Referer': 'http://s.web2.qq.com/proxy.html?v=20130916001&callback=1&id=1'
    },
    json: true
  }, function (e, r, d) {
    cb(e, d)
  })
}
QQ.prototype._getFriendUin = function _getFriendUin(tuin, cb) {
  this.request({
    url: 'http://s.web2.qq.com/api/get_friend_uin2',
    qs: {
      tuin: tuin,
      type: 1,
      vfwebqq: this.store.vfwebqq,
      t: Date.now()
    },
    headers: {
      'Referer': 'http://s.web2.qq.com/proxy.html?v=20130916001&callback=1&id=1'
    },
    json: true
  }, function (e, r, d) {
    cb(e, d)
  })
}

QQ.prototype.getFriendFace = function getFriendFace(uin, cb) {
  this.request({
    url: 'http://face5.web.qq.com/cgi/svr/face/getface',
    qs: {
      cache: 1,
      type: 1,
      f: 40,
      uin: uin,
      t: Math.floor(Date.now() / 1000)
    },
    headers: {
      'Referer': 'http://w.qq.com/'
    },
    encoding: null
  }, function (e, r, b) {
    cb(e, b)
  })
}

QQ.prototype._getOnlineBuddies = function _getOnlineBuddies(cb) {
  this.request({
    url: 'http://d.web2.qq.com/channel/get_online_buddies2',
    qs: {
      vfwebqq: this.store.vfwebqq,
      psessionid: this.store.psessionid,
      t: Date.now(),
      clientid: clientid
    },
    headers: {
      'Referer': 'http://d.web2.qq.com/proxy.html?v=20130916001&callback=1&id=2'
    },
    json: true
  }, function (e, r, d) {
    cb(e, d)
  })
}
QQ.prototype._getRecentList = function _getRecentList(cb) {
  this.request.post({
    url: 'http://d.web2.qq.com/channel/get_recent_list2',
    form: {
      r: JSON.stringify({
        vfwebqq: this.store.vfwebqq,
        clientid: clientid,
        psessionid: this.store.psessionid
      })
    },
    headers: {
      'Referer': 'http://d.web2.qq.com/proxy.html?v=20130916001&callback=1&id=2'
    },
    json: true
  }, function (e, r, d) {
    cb(e, d)
  })
}
QQ.prototype._getUserFriends = function _getUserFriends(cb) {
  this.request.post({
    url: 'http://s.web2.qq.com/api/get_user_friends2',
    form: {
      r: JSON.stringify({
        vfwebqq: this.store.vfwebqq,
        hash: hashU(this.store.uin, this._getPtwebqq())
      })
    },
    headers: {
      'Referer': 'http://s.web2.qq.com/proxy.html?v=20130916001&callback=1&id=1'
    },
    json: true
  }, function (e, r, d) {
    cb(e, d)
  })
}

QQ.prototype.login = function login(password, vcode, cb) {
  var _this = this
  this.form.password = password || ''
  this.form.vcode = vcode || ''
  this._login(function (e, d) {
    var m = d.match(/'([^']*)','([^']*)','([^']*)','([^']*)','([^']*)',\s*'([^']*)'/)
    if (!/成功/.test(m[5])) return cb(e, false, m[5])
    _this.store.nick = m[6]
    _this.request({
      url: m[3],
      headers: {
        'Host': 'ptlogin4.web2.qq.com'
      }
    }, function (e, r, d) {
      _this.request({
        url: 'http://s.web2.qq.com/api/getvfwebqq',
        form: {
          r: JSON.stringify({
            ptwebqq: _this._getPtwebqq(),
            psessionid: '',
            t: Date.now(),
            clientid: clientid
          })
        },
        headers: {
          'Referer': 'http://s.web2.qq.com/proxy.html?v=20130916001&callback=1&id=1'
        },
        json: true
      }, function (e, r, d) {
        _this.store.vfwebqq = d.result.vfwebqq
        _this.request.post({
          url: 'http://d.web2.qq.com/channel/login2',
          form: {
            r: JSON.stringify({
              ptwebqq: _this._getPtwebqq(),
              psessionid: '',
              status: 'online',
              clientid: clientid
            })
          },
          headers: {
            'Referer': 'http://d.web2.qq.com/proxy.html?v=20130916001&callback=1&id=2'
          },
          json: true
        }, function (e, r, d) {
          if (d.retcode) return cb(e, false)
          _this.store._vfwebqq  = d.result.vfwebqq
          _this.store.psessionid  = d.result.psessionid
          _this.store.uin = d.result.uin
          _this._getUserFriends(function (e, d) {
            _this.friends = _.pick(d.result, ['info', 'marknames'])
            cb(e, _this.store.nick)
          })
        })
      })
    })
  })
}

QQ.prototype._login = function _login(cb) {
  var s = this.store
  var f = this.form
  var vcode = s.hasImg ? f.vcode : s.vcode
  this.request({
    url: 'https://ssl.ptlogin2.qq.com/login?webqq_type=10&remember_uin=1&login2qq=1&u1=http%3A%2F%2Fw.qq.com%2Fproxy.html%3Flogin2qq%3D1%26webqq_type%3D10&h=1&ptredirect=0&ptlang=2052&daid=164&from_ui=1&pttype=1&dumy=&fp=loginerroralert&action=0-20-410040&mibao_css=m_webqq&t=1&g=1&js_type=0&js_ver=10109&login_sig=Efi2l6vPodHobOwrxFL8Q6T8UTg5obqH13BcdS5u3N46ezVr3RyUHjCDEcQkcIoc&pt_vcode_v1=0',
    qs: {
      u: f.account,
      p: encrypt(f.password, s.salt, vcode),
      verifycode: vcode,
      pt_verifysession_v1: s.verifysession,
      pt_randsalt: s.isRandSalt || 0,
      aid: appid
    },
    headers: {
      'Referer': 'https://ui.ptlogin2.qq.com/cgi-bin/login?daid=164&target=self&style=16&mibao_css=m_webqq' +
        '&appid=' + appid + '&enable_qlogin=0&no_verifyimg=1&s_url=http%3A%2F%2Fw.qq.com%2Fproxy.html&f_url=loginerroralert&strong_login=1&login_state=10&t=20131024001'
    }
  }, function (e, r, d) {
    cb(e, d)
  })
}

QQ.prototype.getVcode = function getVcode(account, cb) {
  var _this = this
  var s = this.store
  this.form.account = account || ''
  this._checkVcode(function (e, d) {
    var m = d.match(/'([^']*)','([^']*)','([^']*)','([^']*)','([^']*)'/)
    s.vcode = m[2]
    s.salt = Function('return "' + m[3] + '"')()
    s.verifysession = m[4] || _this._getVerifysession()
    s.isRandSalt = m[5]
    s.hasImg = m[1] === '1'
    if (!s.hasImg) return cb(e)
    _this._getVcodeImage(function (e, b) {
      s.verifysession = _this._getVerifysession()
      cb(e, b)
    })
  })
}

QQ.prototype._getVcodeImage = function _getVcodeImage(cb) {
  this.request({
    url: 'https://ssl.captcha.qq.com/getimage',
    qs: {
      uin: this.form.account,
      r: Math.random(),
      aid: appid
    },
    encoding: null
  }, function (e, r, b) {
    cb(e, b)
  })
}

QQ.prototype._checkVcode = function _checkVcode(cb) {
  this.request({
    url: 'https://ssl.ptlogin2.qq.com/check?pt_tea=1&js_ver=10109&js_type=0&login_sig=Hr5gU3cuTeCKinsyESg7XnoaYL*TwxclDHeJQbdol197nlPbIPQPQ*8AR1RuN1-7&u1=http%3A%2F%2Fw.qq.com%2Fproxy.html',
    qs: {
      uin: this.form.account,
      r: Math.random(),
      appid: appid
    },
    headers: {
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, sdch',
      'Accept-Language': 'zh-CN,zh;q=0.8,en;q=0.6',
      'Host': 'ssl.ptlogin2.qq.com',
      'Referer': 'https://ui.ptlogin2.qq.com/cgi-bin/login?daid=164&target=self&style=16&mibao_css=m_webqq&appid=' + appid + '&enable_qlogin=0&no_verifyimg=1&s_url=http%3A%2F%2Fw.qq.com%2Fproxy.html&f_url=loginerroralert&strong_login=1&login_state=10&t=20131024001',
    }
  }, function (e, r, d) {
    cb(e, d)
  })
}

QQ.prototype._getPtwebqq = function _getPtwebqq() {
  var cs = this.jar.getCookies('http://w.qq.com')
  var c = _.find(cs, { key: 'ptwebqq' })
  return c ? c.value : ''
}
QQ.prototype._getVerifysession = function _getVerifysession() {
  var cs = this.jar.getCookies('https://ssl.ptlogin2.qq.com')
  var c = _.find(cs, { key: 'verifysession' })
  return c ? c.value : ''
}

// http://pub.idqqimg.com/smartqq/js/mq.js
var z = 0
var q = Date.now()
q = (q - q % 1E3) / 1E3
q = q % 1E4 * 1E4
function nextMsgId() {
  z++
  return q + z
}
function hashU(x, K) {
  for (var N = K + "password error", T = "", V = [];;)
    if (T.length <= N.length) {
      T += x;
      if (T.length == N.length) break
    } else {
      T = T.slice(0, N.length);
      break
    }
  for (var U = 0; U < T.length; U++) V[U] = T.charCodeAt(U) ^ N.charCodeAt(U);
  N = ["0", "1", "2", "3",
    "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F"
  ];
  T = "";
  for (U = 0; U < V.length; U++) {
    T += N[V[U] >> 4 & 15];
    T += N[V[U] & 15]
  }
  return T
}

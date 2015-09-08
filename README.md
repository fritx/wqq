# wqq

基于 <http://w.qq.com> `v=20130916001` webqq协议 的api模块

类似的项目 [qqbot](https://github.com/xhan/qqbot), [webqq-client](https://github.com/longbai/webqq-client), [Webqq-Client(Perl)](https://github.com/sjdy521/Webqq-Client)

基于wqq开发的一个qq命令行 [qqlog](https://github.com/fritx/qqlog)

```
$ npm install wqq
```

```js
var QQ = require('wqq')
var qq = new QQ()
qq.getVcode(qqnum, function (err, buffer) {
  // 如果需要的话 buffer为验证码图片 一般不会出现
  qq.login(qqpsw, vcode || '', function (err, nick) {
    qq.on('disconnect', function () { exit() })
    qq.on('message', function (msg) { log(msg) })
    qq.startPoll()
  })
})
```

```js
// 实现"qq鹦鹉" 跟人说话 :)
qq.on('message', function (msg) {
  var method = msg.group_name ? 'sendGroupMsg' :
    msg.dicus_name ? 'sendDicusMsg' :
    msg.is_private ? 'sendBuddyMsg' : null
  if (method) {
    qq[method](msg.from_uin, msg.content, function(err, ok){})
  }
})
```

## 功能

- 获取验证码/登录
- 开启/中断消息轮训
- 识别单人/群/讨论组消息
- 识别群匿名/群文件消息
- 识别消息中的文本/图片/emoji
- 识别发送者的昵称/群昵称/备注
- 获取单人/群/讨论组资料
- 发送单人/群/讨论组消息

## 待完善

- 登录状态
- 识别单人/讨论组文件消息
- 呈现消息中qq表情的语义

## 不可抗力

- 无法呈现单人/讨论组文件消息
- 无法呈现/发送图片
- 极个别emoji识别不全
- [webqq即将废弃](http://www.pingwest.com/bye-web-qq/)

## 关闭qq设备锁 才能正常登录

[百度经验 手机qq设备锁怎么解除](http://jingyan.baidu.com/article/60ccbceb005c4c64cab197d8.html)

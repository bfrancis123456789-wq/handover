// Decrypts a Web Push message (RFC 8291, aes128gcm) with the subscriber's keys,
// so tests can check exactly what a device received.
const crypto = require('crypto')

const b64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()

function decrypt(bodyBase64, { jwk, pub, auth }) {
  const body = Buffer.from(bodyBase64, 'base64')
  const salt = body.subarray(0, 16)
  const idlen = body[20]
  const serverPublic = body.subarray(21, 21 + idlen)
  const ciphertext = body.subarray(21 + idlen)

  const priv = crypto.createPrivateKey({ key: jwk, format: 'jwk' })
  const serverKey = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: serverPublic.subarray(1, 33).toString('base64url'), y: serverPublic.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  })
  const shared = crypto.diffieHellman({ privateKey: priv, publicKey: serverKey })

  const prkKey = hmac(b64u(auth), shared)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), b64u(pub), serverPublic, Buffer.from([1])])
  const ikm = hmac(prkKey, keyInfo)
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16)
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12)

  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16))
  let plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()])
  let end = plain.length - 1
  while (end >= 0 && plain[end] === 0) end--
  if (plain[end] !== 2) throw new Error('bad padding delimiter')
  return JSON.parse(plain.subarray(0, end).toString('utf8'))
}

module.exports = { decrypt }

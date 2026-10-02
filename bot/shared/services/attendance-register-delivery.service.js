/**
 * Getting a register into the hands of whoever just marked it.
 *
 * Split from attendance-register.service on purpose: that file is pure — people and
 * records in, a buffer out. This one is the I/O, written so that storage, the channel
 * and the disk can each fail without costing the attendance that was just saved.
 *
 * ORDER MATTERS. Callers run this AFTER the write, never before, so the day just
 * marked is in the file. A sheet missing the register the teacher just saved reads
 * as data loss.
 */

const path = require('path');
const fs = require('fs');
const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { uploadBuffer, isR2Configured } = require('../storage/r2');
const { TEMP_DIR } = require('../utils/constants');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Archive a register to R2 when storage is configured, then send it.
 *
 * R2 is the archive, not the delivery: a deployment with no bucket, or a storage
 * outage, must not stop the file reaching the person who just made it. The send
 * result is returned as it came back from the channel — a refused document is not
 * reported as delivered. Never throws.
 *
 * @param {object} p
 * @param {string} p.to        the address the teacher wrote from (any channel)
 * @param {Buffer} p.buffer
 * @param {string} p.fileName
 * @param {string} p.caption
 * @param {string} p.r2Key
 * @returns {Promise<{sent: boolean, url: string|null}>}
 */
async function deliverRegisterFile({ to, buffer, fileName, caption, r2Key }) {
  let url = null;
  if (isR2Configured()) {
    try {
      url = await uploadBuffer(buffer, r2Key, XLSX_MIME);
    } catch (error) {
      logToFile('⚠️ Register upload to R2 failed — sending anyway', { error: error.message });
    }
  }

  let sent = false;
  let tempFilePath = null;
  try {
    // whatsapp-bot.js creates TEMP_DIR at boot, but this also runs on a fresh
    // container (and from tests) where that boot has not happened; without it the
    // register is generated and then lost to ENOENT.
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    tempFilePath = path.join(TEMP_DIR, fileName);
    fs.writeFileSync(tempFilePath, buffer);
    sent = Boolean(await WhatsAppService.sendDocument(to, tempFilePath, fileName, caption));
  } catch (error) {
    logToFile('❌ Register send failed', { fileName, error: error.message });
  } finally {
    try {
      if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch { /* a temp file is not worth an error */ }
  }
  return { sent, url };
}

module.exports = { deliverRegisterFile, XLSX_MIME };

const nodemailer = require('nodemailer');
const config = require('./config.json');
const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
    },
    logger: true,
    debug: true
});
async function main() {
    try {
        await transporter.verify();
        console.log("Verify OK");
    } catch (e) {
        console.error("Error:", e);
    }
}
main();

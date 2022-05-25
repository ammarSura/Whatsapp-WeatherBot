import { Boom } from '@hapi/boom'
import makeWASocket, { AnyMessageContent, delay, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, MessageRetryMap, useMultiFileAuthState } from '../src'
import MAIN_LOGGER from '../src/Utils/logger'
// Importing functions to access api
const weatherAPI = require('./weather.ts')

export interface ActiveUsers {
	status : Number,
	city: string,
    days?: number,
    data: object,
};

const activeUsers : ActiveUsers = {
	status : 0,
	city : null,
	days: null,
	data: null

}
const logger = MAIN_LOGGER.child({ })
logger.level = 'trace'

const useStore = !process.argv.includes('--no-store')
const doReplies = !process.argv.includes('--no-reply')

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterMap: MessageRetryMap = { }

// the store maintains the data of the WA connection in memory
// can be written out to a file & read from it
const store = useStore ? makeInMemoryStore({ logger }) : undefined
store?.readFromFile('./baileys_store_multi.json')
// save every 10s
setInterval(() => {
	store?.writeToFile('./baileys_store_multi.json')
}, 10_000)

// start a connection
const startSock = async() => {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	const sock = makeWASocket({
		version,
		logger,
		printQRInTerminal: true,
		auth: state,
		msgRetryCounterMap,
		// implement to handle retries
		getMessage: async key => {
			return {
				conversation: 'hello'
			}
		}
	})

	store?.bind(sock.ev)

	const sendMessageWTyping = async(msg: AnyMessageContent, jid: string) => {
		await sock.presenceSubscribe(jid)
		await delay(500)

		await sock.sendPresenceUpdate('composing', jid)
		await delay(2000)

		await sock.sendPresenceUpdate('paused', jid)

		await sock.sendMessage(jid, msg)
	}

	
	// weather bot
	sock.ev.on('messages.upsert', async m => {
		console.log(JSON.stringify(m, undefined, 2))

		const msg = m.messages[0];
        
		if(!msg.key.fromMe && m.type === 'notify' && doReplies) {
            
			if (!(msg.key.remoteJid in activeUsers)) {
				activeUsers[msg.key.remoteJid] = {
					status: 0,
					city: null,
					days: null,
					data: null
				};
				await sendMessageWTyping( 
					{text: 'Hi! Welcome to WeatherBot. Enter your city\'s name for weather information.'}, msg.key.remoteJid)
			} else {
					
					if (activeUsers[msg.key.remoteJid].status === 0) {
						
						activeUsers[msg.key.remoteJid].city = m.messages[0].message.conversation.trim();
						const weatherData = await weatherAPI.getWeatherFromCityName(activeUsers[msg.key.remoteJid].city);    

						if (weatherData) {
							await sendMessageWTyping( 
								{text: 'Perfect! How many days do you want the information for starting today? (max. 7)'}, msg.key.remoteJid)
							activeUsers[msg.key.remoteJid].status = 1;
							activeUsers[msg.key.remoteJid].data = weatherData;
							
							
						} else {
							await sendMessageWTyping({ text: 'Invalid entry. Try again.'}, msg.key.remoteJid) 
							activeUsers[msg.key.remoteJid].status = 0;
						}
					} else {

					
						const inp = parseInt(m.messages[0].message.conversation.trim());
						if (inp) {
							const days = Math.min(inp, 7);
							const data = activeUsers[msg.key.remoteJid].data;
							let s1 = `Today's weather in ${activeUsers[msg.key.remoteJid].data.cityName}: \nTemperature: ${String(data.current_weather.temperature)} °C \n\n` 
							
							for (let i = 0; i < days; i++) {
								const s2 = `${new Date(data.daily.time[i]).toLocaleDateString('en-us', { weekday:"long", year:"numeric", month:"short", day:"numeric"})} \nMinimum temperature: ${data.daily.temperature_2m_min[i]} °C \nMaximum temperature: ${data.daily.temperature_2m_max[i]} °C \nPrecipitation: ${data.daily.precipitation_sum[i]} mm\n\n` ;
								s1 = s1 + s2;
							}
							await sendMessageWTyping({ text: s1}, msg.key.remoteJid)
							delete activeUsers[msg.key.remoteJid] ;

						} else {
							await sendMessageWTyping({ text: 'Invalid entry. Try again.'}, msg.key.remoteJid) 
							activeUsers[msg.key.remoteJid].status = 1;
						}
								
						}
					}
                
                
			}
			await sock!.sendReadReceipt(msg.key.remoteJid, msg.key.participant, [msg.key.id])
			
			
		

	})

	

	sock.ev.on('connection.update', (update) => {
		const { connection, lastDisconnect } = update
		if(connection === 'close') {
			// reconnect if not logged out
			if((lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
				startSock()
			} else {
				console.log('Connection closed. You are logged out.')
			}
		}

		
	})
	sock.ev.on('creds.update', saveCreds)

	return sock
}

startSock()
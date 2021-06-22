/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { Server } from 'revolt.js/dist/api/objects'
import { Channel, Message, User } from 'revolt.js'
import { IDBPDatabase, openDB } from 'idb'
import { decodeTime } from 'ulid'

declare let self: ServiceWorkerGlobalScope

self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING')
	self.skipWaiting()
})

precacheAndRoute(self.__WB_MANIFEST)

const base_url = `https://autumn.revolt.chat`;
self.addEventListener("push", event => {
	async function process() {
		if (event.data === null) return;
		let data: Message = event.data.json();

		let db: IDBPDatabase;
		try {
			// Match RevoltClient.tsx#L55
			db = await openDB('state', 3, {
				upgrade(db) {
					for (let store of [ "channels", "servers", "users", "members" ]) {
						db.createObjectStore(store, {
							keyPath: '_id'
						});
					}
				},
			});
		} catch (err) {
			console.error('Failed to open IndexedDB store, continuing without.');
			return;
		}

		async function get<T>(store: string, key: string): Promise<T | undefined> {
			try {
				return await db.get(store, key);
			} catch (err) {
				return undefined;
			}
		}
		
		let image;
		if (data.attachments) {
			let attachment = data.attachments[0];
			if (attachment.metadata.type === "Image") {
				image = `${base_url}/${attachment.tag}/${attachment._id}`;
			}
		}
		
		let title = `@${data.author}`;
		let channel = await get<Channel>('channels', data.channel);
		let user = await get<User>('users', data.author);
		let username = user?.username ?? data.author;
		
		switch (channel?.channel_type) {
			case "SavedMessages": break;
			case "DirectMessage": title = `@${username}`; break;
			case "Group":
				if (user?._id === '00000000000000000000000000') {
					title = channel.name;
				} else {
					title = `@${user?.username} - ${channel.name}`;
				}
				break;
			case "TextChannel":
				{
					let server = await get<Server>('servers', channel.server);
					title = `@${user?.username} (#${channel.name}, ${server?.name})`;
				}
				break;
		}
		
		await self.registration.showNotification(title, {
			icon: user?.avatar ? `${base_url}/${user.avatar.tag}/${user.avatar._id}` : `https://api.revolt.chat/users/${data.author}/default_avatar`,
			image,
			body: typeof data.content === "string" ? data.content : JSON.stringify(data.content),
			timestamp: decodeTime(data._id),
			tag: data.channel,
			badge: "https://app.revolt.chat/assets/icons/android-chrome-512x512.png",
			data: channel?.channel_type === 'TextChannel' ? `/server/${channel.server}/channel/${channel._id}` : `/channel/${data.channel}`
		});
	}
		
	event.waitUntil(process());
});

// ? Open the app on notification click.
// https://stackoverflow.com/a/39457287
self.addEventListener("notificationclick", function(event) {
	let url = event.notification.data;
	event.notification.close();
	event.waitUntil(
		self.clients
			.matchAll({ includeUncontrolled: true, type: "window" })
			.then(windowClients => {
				// Check if there is already a window/tab open with the target URL
				for (var i = 0; i < windowClients.length; i++) {
					var client = windowClients[i];
					// If so, just focus it.
					if (client.url === url && "focus" in client) {
						return client.focus();
					}
				}

				// If not, then open the target URL in a new window/tab.
				if (self.clients.openWindow) {
					return self.clients.openWindow(url);
				}
			})
	);
});
	
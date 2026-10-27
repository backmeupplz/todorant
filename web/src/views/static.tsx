// Plain anchors and no app imports: the build also renders these pages to static HTML (vite.config.ts)
// (the English strings are data, so How it works reads its rules from them)
import en from '../i18n/en.json'
const Back = () => <p><a href="/">Back to main page</a></p>

export const Privacy = () => (
  <article class="static">
    <h1>Privacy Policy of Todorant</h1>
    <p>Effective October 13, 2026</p>
    <p>Todorant is a todo manager made by Nikita Kolmogorov. It runs on the web at todorant.com and as apps for Android and iPhone. This policy explains what data Todorant collects, why, who else sees it and how you can delete it. If you have questions, email <a href="mailto:n@borodutch.com">n@borodutch.com</a>.</p>
    <h2>Using Todorant without an account</h2>
    <p>The Android and iPhone apps work without signing in. In that case your todos stay on your device and nothing about them is sent to our servers.</p>
    <h2>What we collect when you sign in</h2>
    <ul>
      <li><b>Your account:</b> your name, your email address and the ID of the sign-in method you chose (Google, Apple, Facebook, Telegram, or an email address and password). We store passwords only as a salted hash.</li>
      <li><b>What you put into Todorant:</b> your todos with their dates and times, hashtags, epics and settings such as your language and time zone, along with statistics about the todos you complete. We keep them so that your todos sync between your devices.</li>
      <li><b>Delegation:</b> when you connect with another person through an invite link, we store that connection and the todos you send to each other.</li>
      <li><b>Telegram bot:</b> if you use the Telegram bot, we store your Telegram ID, and the messages you send to the bot become todos.</li>
      <li><b>Technical data:</b> our servers process your IP address and the details of each request in order to answer it and keep the service secure. When a request fails, an error report with technical details is sent to the developer so the bug can be fixed.</li>
      <li><b>Code scanner on Android:</b> when you scan a QR code to sign in on another device, the Android app uses Google's code scanner. It sends Google anonymous diagnostics (such as the device model, the Android version and performance metrics) along with an identifier tied to the app installation, as described in Google's ML Kit data disclosure. This data isn't linked to your Todorant account.</li>
    </ul>
    <h2>How we use it</h2>
    <p>We use your data only to run Todorant: to sign you in, store and sync your todos, deliver delegated todos, run the integrations you turn on, keep the service secure and fix bugs. We don't sell your data, we don't show ads, and we don't use advertising or analytics trackers.</p>
    <p>If you turn on encryption, the text of your todos is encrypted on your device with a password that never leaves it, and our servers only see the encrypted text.</p>
    <h2>Who else sees it</h2>
    <ul>
      <li><b>People you choose:</b> the people you delegate todos to, and who delegate todos to you, see those todos and your name. If you share a link to a report, anyone with the link can see that report.</li>
      <li><b>Sign-in and integration providers:</b> Google, Apple, Facebook and Telegram process your data when you use them with Todorant, under their own privacy policies.</li>
      <li><b>Hosting:</b> our servers and database run at Hetzner Online in Germany, and the todorant.com website is served by GitHub Pages. Error reports reach the developer through Telegram.</li>
      <li><b>The law:</b> we disclose data when the law requires it.</li>
    </ul>
    <p>Todorant's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
    <h2>How long we keep it and how to delete it</h2>
    <p>We keep your data while your account exists. When you delete a todo or a hashtag, it disappears from all your devices, but our database keeps a record of the deletion so that every device can sync it, until you delete your account.</p>
    <p>You can delete your account in Settings → Delete account in the Android or iPhone app or on todorant.com. Your account and everything in it are removed from our live database immediately. <a href="/delete-account">This page</a> describes what is deleted, and if you can't sign in, you can email <a href="mailto:n@borodutch.com">n@borodutch.com</a> from the address on your account.</p>
    <h2>Your own server</h2>
    <p>The apps can connect to a Todorant server that you or someone else runs. Your data then goes to that server instead of ours, and whoever runs it is responsible for it.</p>
    <h2>Children</h2>
    <p>Todorant isn't meant for children under 13, and we don't knowingly collect data from them. If you believe a child has given us personal data, email us and we will delete it.</p>
    <h2>Security</h2>
    <p>All traffic between the apps and our servers is encrypted with HTTPS, passwords are hashed, and access to the servers is restricted. No system is perfectly secure, so we can't guarantee that your data will never be exposed.</p>
    <h2>Changes</h2>
    <p>When this policy changes, we post the new version on this page and update the date at the top.</p>
    <Back />
  </article>
)

export const Terms = () => (
  <article class="static">
    <h1>Terms and Conditions of Use</h1>
    <h2>1. Terms</h2>
    <p>By accessing this Website, accessible from https://todorant.com, you are agreeing to be bound by these Website Terms and Conditions of Use and agree that you are responsible for the agreement with any applicable local laws. If you disagree with any of these terms, you are prohibited from accessing this site. The materials contained in this Website are protected by copyright and trade mark law.</p>
    <h2>2. Disclaimer</h2>
    <p>All the materials on Todorant’s Website are provided "as is". Todorant makes no warranties, may it be expressed or implied, therefore negates all other warranties. Furthermore, Todorant does not make any representations concerning the accuracy or reliability of the use of the materials on its Website or otherwise relating to such materials or any sites linked to this Website.</p>
    <h2>3. Limitations</h2>
    <p>Todorant or its suppliers will not be hold accountable for any damages that will arise with the use or inability to use the materials on Todorant’s Website, even if Todorant or an authorize representative of this Website has been notified, orally or written, of the possibility of such damage. Some jurisdiction does not allow limitations on implied warranties or limitations of liability for incidental damages, these limitations may not apply to you.</p>
    <h2>4. Revisions and Errata</h2>
    <p>The materials appearing on Todorant’s Website may include technical, typographical, or photographic errors. Todorant will not promise that any of the materials in this Website are accurate, complete, or current. Todorant may change the materials contained on its Website at any time without notice. Todorant does not make any commitment to update the materials.</p>
    <h2>5. Links</h2>
    <p>Todorant has not reviewed all of the sites linked to its Website and is not responsible for the contents of any such linked site. The presence of any link does not imply endorsement by Todorant of the site. The use of any linked website is at the user’s own risk.</p>
    <h2>6. Site Terms of Use Modifications</h2>
    <p>Todorant may revise these Terms of Use for its Website at any time without prior notice. By using this Website, you are agreeing to be bound by the current version of these Terms and Conditions of Use.</p>
    <h2>7. Your Privacy</h2>
    <p>Please read <a href="/privacy">our Privacy Policy</a>.</p>
    <h2>8. Governing Law</h2>
    <p>Any claim related to Todorant's Website shall be governed by the laws of ca without regards to its conflict of law provisions.</p>
    <h2>9. Encryption</h2>
    <p>In case if the user enables encryption, there is no way to decrypt the data without the password specified by the user.</p>
    <Back />
  </article>
)

export const DeleteAccount = () => (
  <article class="static">
    <h1>Delete your Todorant account</h1>
    <p>Todorant is made by Nikita Kolmogorov. You can delete your Todorant account and everything in it at any time.</p>
    <h2>How to delete it</h2>
    <ul>
      <li><b>Android and iPhone apps:</b> open Settings and tap Delete account.</li>
      <li><b>Web:</b> sign in at <a href="/">todorant.com</a>, open Settings and click Delete account.</li>
      <li><b>Can't sign in?</b> Email <a href="mailto:n@borodutch.com">n@borodutch.com</a> from the address on your account and ask for it to be deleted.</li>
    </ul>
    <h2>What gets deleted</h2>
    <p>Your account and profile (name, email address and linked sign-in IDs), all your todos, hashtags and settings, your hero points and shared reports, and your delegation links. Todos other people delegated to you are removed from their lists too. All of it is removed from the live database immediately and can't be restored.</p>
    <h2>What stays</h2>
    <p>Todos you delegated to other people that they accepted stay in their accounts, because they belong to them now.</p>
    <h2>Delete some of your data and keep the account</h2>
    <p>You can delete any todo or hashtag in the app at any time, and it disappears from all your devices. To remove everything from Todorant's servers, delete the account as described above.</p>
    <Back />
  </article>
)

/** What Todorant is and how it works, as plain HTML that search engines and AI crawlers can read without running the app */
export const HowItWorks = () => (
  <article class="static">
    <h1>How Todorant works</h1>
    <p>Todorant is a todo manager that uses behavioral psychology to help you get things done. It runs on the web at todorant.com and as apps for iPhone, iPad and Android, and you can host your own server. It's made by Nikita Kolmogorov.</p>
    <p>Most productivity apps are great at storing, organizing and automating endless lists of tasks, and that is exactly where they fail you: a list that keeps growing doesn't get anything done. Todorant cares about the one thing that matters, which is finishing what you planned. It does that with four simple ideas, backed by a carefully tuned set of limits and praise that makes the primitive part of your brain crave completed todos the way people crave sugar.</p>
    <h2>Four ideas</h2>
    <ul>
      <li><b>Focus on one task at a time.</b> The Current screen shows only the todo you should be doing right now.</li>
      <li><b>Always add a date or a month to a task.</b> Every todo gets its place in time, so nothing lingers in a list forever.</li>
      <li><b>Complete unpleasant tasks first.</b> Todos you dread are marked as frogs and come before everything else on their day.</li>
      <li><b>Keep your inbox empty.</b> Overdue todos have to be planned again before you can get back to work.</li>
    </ul>
    <p>Todorant grew out of more than twenty productivity books and methodologies. When they failed one by one, the parts that worked were combined and simplified into a single system that you can learn in a minute.</p>
    <h2>The rules</h2>
    <p>These are the rules the app shows when you start, and they are always in Settings under How to use.</p>
    <ol>{(en.rules as string[]).map((rule) => <li key={rule}>{rule}</li>)}</ol>
    <h2>What's inside</h2>
    <ul>
      <li><b>Realtime sync</b> between all your devices, with offline support and field-level conflict resolution, so changes made on two devices at once both survive.</li>
      <li><b>End-to-end encryption</b> of your todos with a password of your choice.</li>
      <li><b>Delegation</b>, to hand todos to friends and colleagues and accept the ones they hand to you.</li>
      <li>A <b>Telegram bot</b> that turns messages into todos, <b>hashtags and epics</b> to group related work, and <b>reports</b> of everything you've done.</li>
      <li><b>More than twenty languages</b>, from German, French and Spanish to Japanese, Chinese, Arabic and Hindi, that follow your device language, and a dark mode on every platform.</li>
    </ul>
    <h2>Get Todorant</h2>
    <ul>
      <li><a href="/">Use it on the web</a></li>
      <li><a href="https://apps.apple.com/app/todorant/id1482078243">iPhone and iPad (App Store)</a></li>
      <li><a href="https://play.google.com/store/apps/details?id=com.todorant">Android (Google Play)</a></li>
      <li><a href="https://github.com/backmeupplz/todorant/blob/main/docs/self-hosting.md">Host your own server</a></li>
      <li><a href="https://github.com/backmeupplz/todorant">Source code</a></li>
    </ul>
    <Back />
  </article>
)


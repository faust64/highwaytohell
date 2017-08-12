# API

Table of Contents
=================

  * [API](#api)
    * [Routes Inventory](#routes-inventory)
    * [Registration Process](#registration-process)
    * [2FA Authentication Workflow](#2fa-authentication-workflow)
    * [Notes on Token-Based Authentication](#notes-on-token-based-authentication)

## Routes Inventory

| Method | Path                                     | Desc                       |
| -----: | :--------------------------------------: | :------------------------: |
| GET    | /                                        | login|domains redirect     |
| GET    | /ping                                    | worker health              |
| GET    | /version                                 | hwth version string        |
| GET    | /domains                                 | 500                        |
| POST   | /domains                                 | api list zones             |
| GET    | /domains/:domainName                     | 500                        |
| POST   | /domains/:domainName                     | api zone record            |
| GET    | /domains/:domainName/add                 | 500                        |
| POST   | /domains/:domainName/add                 | api add domain             |
| GET    | /domains/:domainName/del                 | 500                        |
| POST   | /domains/:domainName/del                 | api delete domain          |
| GET    | /domains/:domainName/disablednssec       | 500                        |
| POST   | /domains/:domainName/disablednssec       | api disable dnssec         |
| GET    | /domains/:domainName/enablednssec        | 500                        |
| POST   | /domains/:domainName/enablednssec        | api enable dnssec          |
| GET    | /healthchecks/:domainName/add            | 500                        |
| POST   | /healthchecks/:domainName/add            | api adds healthcheck       |
| GET    | /healthchecks/:domainName/del/:checkId   | 500                        |
| POST   | /healthchecks/:domainName/del/:checkId   | api delete healthcheck     |
| GET    | /healthchecks/:domainName/edit/:checkId  | 500                        |
| POST   | /healthchecks/:domainName/edit/:checkId  | api edit healthcheck       |
| GET    | /healthchecks/:domainName/get/:checkId   | browser get healthcheck    |
| POST   | /healthchecks/:domainName/get/:checkId   | api get healthcheck        |
| GET    | /healthchecks/:domainName                | browser list healthchecks  |
| POST   | /healthchecks/:domainName                | api list healthchecks      |
| GET    | /healthhistory/:domainName/get/:checkId  | browser checks history     |
| POST   | /healthhistory/:domainName/get/:checkId  | api checks history         |
| GET    | /notifications/:domainName/add/:checkId  | 500                        |
| POST   | /notifications/:domainName/add/:checkId  | api add notification       |
| GET    | /notifications/:domainName/del/:checkId  | 500                        |
| POST   | /notifications/:domainName/del/:checkId  | api drop notification      |
| GET    | /notifications/:domainName/edit/:checkId | 500                        |
| POST   | /notifications/:domainName/edit/:checkId | api edit notification      |
| GET    | /notifications/:domainName/get/:checkId  | browser get notifications  |
| POST   | /notifications/:domainName/get/:checkId  | api get notifications      |
| GET    | /notifications/:domainName               | browser list notifications |
| POST   | /notifications/:domainName               | api list notifications     |
| GET    | /records/:domainName/add/:recordName     | 500                        |
| POST   | /records/:domainName/add/:recordName     | api add record             |
| GET    | /records/:domainName/del/:recordName     | 500                        |
| POST   | /records/:domainName/del/:recordName     | api drop record            |
| GET    | /records/:domainName/edit/:recordName    | 500                        |
| POST   | /records/:domainName/edit/:recordName    | api edit record            |
| GET    | /records/:domainName/get/:recordName     | browser get records        |
| POST   | /records/:domainName/get/:recordName     | api get records            |
| GET    | /records/:domainName                     | browser list tokens        |
| POST   | /records/:domainName                     | api list records           |
| GET    | /tokens/add                              | 500                        |
| POST   | /tokens/add                              | api generate token         |
| GET    | /tokens/edit                             | 500                        |
| POST   | /tokens/edit                             | edit api token             |
| GET    | /tokens/del                              | 500                        |
| POST   | /tokens/del                              | api drop token             |
| GET    | /tokens                                  | browser list tokens        |
| POST   | /tokens                                  | api list tokens            |
| GET    | /settings/2fa/enable                     | 500                        |
| POST   | /settings/2fa/enable                     | enable 2fa auth            |
| GET    | /settings/2fa/confirm                    | 500                        |
| POST   | /settings/2fa/confirm                    | confirm 2fa code           |
| GET    | /settings/2fa/disable                    | 500                        |
| POST   | /settings/2fa/disable                    | disable 2fa auth           |
| GET    | /settings/confirm-address/:userId/:token | confirm registration email |
| GET    | /settings/logs                           | 500                        |
| POST   | /settings/logs                           | api list login history     |
| GET    | /settings                                | browser user settings      |
| POST   | /settings                                | update user settings       |

## Registration Process

From the login page, a non-authenticated user may register a new account. Doing
so, he would enter his email address, an username - which is only used rendering
templates and does not need to be unique - and the same password twice. Both
browser-based client and backend would ensure these passwords match.

If our Cassandra database already has an user record whose address matches the
one registering, then we would deny account from being created.

If passwords match and email is unknown, then we generate a token that we store
in Cassandra. We then format and send an email to that address, including a
confirmation link pointing to our apiGW (`/settings/confirm-address`). That link
is formatted such as we would be able to retrieve an user ID and a token string,
we would then check against our database. If we do have an user ID matching
input, and that the corresponding token matches input, then account is marked
active and may login.

Sending emails, your apiGW workers profile should define a few variables, so
we would know where to relay our messages (usually some internal SMTP, that
would then DKIM-sign or whatever, ...) and how to format the confirmation
link URL:

```
# confirmation link URL should start with https://api-ns.example.com/
export HWTH_HOSTNAME=api-ns.example.com
export HWTH_PROTO=https
# mails should be formatted with:
export MAIL_FROM=heyhey@example.com
export MAIL_REPLYTO=noreply@example.com
# mails should be relayed through:
export SMTP_HOST=smtp.example.com
```

## 2FA Authentication Workflow

Using widely-spread libraries (`speakeasy`, `qrcode`). Being connected to our
apiGW frontend from a browser, a user may access his account settings and click
a button that would take him to the 2FA enrolment page (`/settings/2fa/enable`).

At that point, a secret was generated on the backend, saved in Cassandra, user
is being served with a QRcode to pair his authenticator device with. Having
scanned our code, user may enter a valid code to a form that would the try
to confirm authenticator is properly configured (through
`/settings/2fa/confirm`).

If we could not confirm user input, then user may try configuring his
authenticator device again, which would over-write the previous secret we
kept in Cassandra (PK being base on the userid, cassandra INSERT being
UPDATE-capable, ...).

Otherwise, assuming user input can pass the speakeasy validation against the
record we kept in cassandra, then we update the twofa table marking that
this user secret is now active.

At which point in time, when user goes back to his settings page, he is now
dicourraged - yet offered - to deconfigure 2FA authentication, wiping our
secret from Cassandra (`/settings/2fa/disable`). To do this, user has to
re-enter a valid 2FA code.

When 2FA is configured on an account, the login process would behave such
as having confirmed user exists and password matches, then we would
generate a token that we would keep in Redis with a 5 minutes TTL, such as
`$useremail` -> `$token`. We then render a second form with a couple
hidden inputs: a user ID as kept in cassandra, and our token.
User has now to enter is 2FA code and submit it (to `/login/2fa`).

The last validation would user the hidden userid field retrieving user
email address. Email address is used to retrive our 2FA token from Redis
- note retrieving the token will drop it from dataset, preventing from
it being used twice. Retrieved token is compared to the one sent by
user (which should confirm both requests came from the same end). If
everything matches, we create a new Redis keys, marking user as
2FA-authenticated for the next whatever-TTL (1 hour?). Although note
that as of right now, our login process does not check for such token
existence, expect for having to 2fa-login each time ....

## Notes on Token-Based Authentication

Accessing our API can be done using tokens.

Accounts subjects to 2FA would not be required to enter their 2FA code using
their tokens.

Tokens can be generated from our apiGW frontend, from the settings page.

Creating or editing tokens, you may set a source ACL string. By default, it
would be set to `*`, allowing anyone to log in using that token. Eventually,
you may enter a comma-separated list of IPs or networks. In doing so, backend
would refuse to authenticate users presenting with that token, unless client
IP matches an item from that list.

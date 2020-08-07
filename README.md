# Blue Canvas Node.js SDK PMD Example

## Deploying to Heroku

Create a new Docker app and connect it to your repository:

```
$ heroku apps:create --stack=container MY_APP_NAME
$ heroku git:remote -a MY_APP_NAME
```

Configure the Blue Canvas tenant and repository IDs. These can be found in the
`git clone` URL at the bottom of the "Branches" page in the "How to make a local
copy of your files" section. For instance in the URL:

```
https://git.bluecanvas.io/t186f348b-d05a-b4f4-89d3-2f80e6fd1199/r3bb9a056-4bd8-741c-ca01-6d491f4dacb1.git
```

The tenant ID is `t186f348b-d05a-b4f4-89d3-2f80e6fd1199` and the repository ID
is `r3bb9a056-4bd8-741c-ca01-6d491f4dacb1`.

`BLUECANVAS_CLIENT_ID` and `BLUECANVAS_CLIENT_SECRET` can be copied from the `Settings > API` page.

`BASE_URL` should your Heroku app's `Web URL`, shown in `heroku apps:info`:

```
$ heroku apps:info
=== MY_APP
Auto Cert Mgmt: false
Dynos:          web: 1
Git URL:        https://git.heroku.com/MY_APP.git
Owner:          me@example.com
Region:         us
Repo Size:      13 KB
Slug Size:      33 MB
Stack:          container
Web URL:        https://MY_APP.herokuapp.com/
```

Set the config variables:

```
$ heroku config:set -a MY_APP BLUECANVAS_CLIENT_ID=MY_CLIENT_ID
$ heroku config:set -a MY_APP BLUECANVAS_CLIENT_SECRET=MY_CLIENT_SECRET
$ heroku config:set -a MY_APP BLUECANVAS_TENANT_ID=MY_TENANT_ID
$ heroku config:set -a MY_APP BLUECANVAS_REPO_ID=MY_REPO_ID
$ heroku config:set -a MY_APP BASE_URL=MY_HEROKU_APP_URL
```

Finally, push to Heroku to start the app:

```
$ git push heroku master
```

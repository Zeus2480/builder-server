#!/bin/bash

export GIT_REPOSITORY_URL="$GIT_REPOSITORY__URL"

git clone "$GIT_REPOSITORY_URL" /home/app/output

exec node script.js

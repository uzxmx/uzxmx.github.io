# uzxmx.github.io

This is a [Jekyll](https://jekyllrb.com/) project. The website can be viewed at
[here](https://uzxmx.github.io/).

## Run Jekyll on the local

```
bundle exec jekyll serve --config _config.yml,_config.dev.yml

# Show drafts
bundle exec jekyll serve --config _config.yml,_config.dev.yml --drafts
```

## Add Jekyll plugin

After adding jekyll plugin in `Gemfile` and `_config.yml`, run the following:

```
JEKYLL_ENV=production bundle install
```

## Build Jekyll project

```
# By specifying `JEKYLL_ENV=production`, the `minimal-mistakes-jekyll` plugin
# will output codes that support comment function.
JEKYLL_ENV=production bundle exec jekyll build --config _config.yml,_config.dev.yml
```

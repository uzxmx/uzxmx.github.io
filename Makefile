build:
	bundle install
	JEKYLL_ENV=production bundle exec jekyll build --config _config.yml,_config.dev.yml

.PHONY: build

release: build
	./scripts/release

.PHONY: release

clean:
	bundle install
	bundle exec jekyll clean

.PHONY: clean

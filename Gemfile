source 'https://rubygems.org'

git_source(:github) { |repo_name| "https://github.com/#{repo_name}" }

gem 'minimal-mistakes-jekyll', '~> 4.19.1'
gem 'jekyll-snippet', github: 'uzxmx/jekyll-snippet'

# Because GitHub Pages doesn't support loading custom Jekyll plugin, we resort
# to building Jekyll project beforehand and checking the build output into
# version control. So below code snippets are unnecessary.
#
# if ENV['JEKYLL_ENV'] == 'production'
#   gem "github-pages", "~> 204", group: :jekyll_plugins
#
#   group :jekyll_plugins do
#     gem 'jekyll-include-cache', '~> 0.2.0'
#     gem 'jekyll-sitemap', '~> 1.4'
#   end
# end

# Windows and JRuby does not include zoneinfo files, so bundle the tzinfo-data gem
# and associated library.
install_if -> { RUBY_PLATFORM =~ %r!mingw|mswin|java! } do
  gem "tzinfo", "~> 1.2"
  gem "tzinfo-data"
end

# Performance-booster for watching directories on Windows
gem "wdm", "~> 0.1.1", :install_if => Gem.win_platform?

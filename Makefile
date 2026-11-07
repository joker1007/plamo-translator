NAME    := plamo-translator
VERSION := $(shell jq -r .version manifest.json)
DIST    := dist
XPI     := $(DIST)/$(NAME)-$(VERSION).xpi

# 拡張に含めるファイル。追加したらここにも足す。
SRCS := manifest.json background.js content.js defaults.js options.html options.js

.PHONY: all xpi lint clean

all: xpi

xpi: $(XPI)

# xpi は manifest.json をルートに置いた zip。
# -X で uid/gid などの付加情報を落とし、-D でディレクトリエントリを入れない。
$(XPI): $(SRCS) | $(DIST)
	jq empty manifest.json
	rm -f $@
	zip -q -X -D $@ $(SRCS)
	@echo "created $@"

$(DIST):
	mkdir -p $@

lint:
	jq empty manifest.json
	for f in $(filter %.js,$(SRCS)); do node --check $$f || exit 1; done

clean:
	rm -rf $(DIST)

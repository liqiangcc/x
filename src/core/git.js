"use strict";

const {
  existingPathspecs,
  hasDiff,
  stagedFiles,
} = require("../adapters/git/exec_git_workspace");

module.exports = {
  existingPathspecs,
  hasDiff,
  stagedFiles,
};

require "minitest/autorun"
require "fastlane"

class SigningFilesTest < Minitest::Test
  FASTFILE = Fastlane::FastFile.new(File.join(__dir__, "fastlane/Fastfile"))

  def test_decodes_multiline_input_with_owner_only_permissions
    Dir.mktmpdir do |directory|
      path = FASTFILE.send(:secret_file, directory, "fixture.jks", "Zml4\ndHVyZQ==\n", base64: true)
      assert_equal "fixture", File.binread(path)
      assert_equal 0600, File.stat(path).mode & 0777
    end
  end

  def test_invalid_encoding_leaves_no_file
    Dir.mktmpdir do |directory|
      assert_raises(ArgumentError) do
        FASTFILE.send(:secret_file, directory, "fixture.p12", "invalid!", base64: true)
      end
      refute File.exist?(File.join(directory, "fixture.p12"))
    end
  end
end

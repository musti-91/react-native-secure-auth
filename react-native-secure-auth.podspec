require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = package['name']
  s.version      = package['version']
  s.summary      = package['description']
  s.license      = package['license']
  s.authors      = 'react-native-secure-auth contributors'
  s.homepage     = 'https://github.com/OWNER/react-native-secure-auth'
  s.platform     = :ios, '15.1'
  s.source       = { :git => 'https://github.com/OWNER/react-native-secure-auth.git', :tag => "v#{s.version}" }
  s.source_files = 'ios/**/*.{h,m}'
  s.requires_arc = true
  s.frameworks   = 'SafariServices', 'WebKit', 'AuthenticationServices'
  s.dependency 'React-Core'
  s.dependency 'AppAuth', '>= 1.7.6'
end
